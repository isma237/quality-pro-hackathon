import os
import boto3
import json
import logging
import re  # Added missing import for regular expressions

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Bedrock client at module level (reused across invocations)
bedrock_runtime = boto3.client(
    'bedrock-runtime',
    region_name='us-west-2',
)

_prompts_config_cache = None

def load_prompts_config():
    """Charge la configuration des prompts depuis le fichier JSON"""
    try:
        config_path = os.path.join(os.path.dirname(__file__), 'prompts-config.json')
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        return config
    except FileNotFoundError:
        logger.error(f"Fichier prompts-config.json non trouvé")
        raise
    except json.JSONDecodeError as e:
        logger.error(f"Erreur de parsing JSON: {str(e)}")
        raise

def get_prompts_config():
    """Récupère la configuration avec mise en cache"""
    global _prompts_config_cache
    if _prompts_config_cache is None:
        _prompts_config_cache = load_prompts_config()
        logger.info("Configuration des prompts chargée et mise en cache")
    return _prompts_config_cache

def clean_response(text):
    """
    Nettoie et formate correctement la réponse du modèle
    
    Args:
        text (str): Texte de la réponse à nettoyer
        
    Returns:
        str: Texte nettoyé et correctement formaté
    """
    if not text:
        return text
        
    # 1. Supprimer les préfixes communs qui ne sont pas nécessaires
    prefixes_to_remove = [
        "Après avoir analysé la transcription de l'appel, ",
        "Voici ",
        "D'après l'analyse de la transcription, ",
        "Basé sur la transcription fournie, "
    ]
    
    for prefix in prefixes_to_remove:
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    
    # 2. Supprimer tout formatage markdown
    # Suppression des titres (#)
    text = re.sub(r'#+\s+', '', text)
    # Suppression des formatages gras/italique/souligné
    text = re.sub(r'[*_~]{1,3}(.*?)[*_~]{1,3}', r'\1', text)
    # Suppression des blocs de code
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    # Suppression des liens markdown
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    
    # 3. Convertir les séquences d'échappement en véritables sauts de ligne
    text = text.replace('\\n', '\n')
    
    # 4. Gérer les listes à puces pour un affichage propre dans une application web
    # Remplacer "\n- " par " • " (avec espace avant et après le point)
    text = text.replace('\n- ', ' • ')
    text = text.replace('\n* ', ' • ')
    
    # 5. Gérer les listes numérotées
    # Chercher des motifs comme "\n1. ", "\n2. " etc.
    text = re.sub(r'\n\d+\.\s+', ' | ', text)
    
    # 6. Supprimer les espaces et sauts de ligne superflus
    text = re.sub(r'\n{3,}', '\n\n', text)  # Remplacer 3+ sauts de ligne par 2
    
    # 7. Remplacer les sauts de ligne restants par des espaces pour un texte plat
    text = text.replace('\n', ' ')
    
    # 8. Supprimer les espaces multiples
    text = re.sub(r'\s{2,}', ' ', text)
    
    # 9. Nettoyer le texte final
    text = text.strip()
    
    return text

def invoke_bedrock(input_text, prompt=None):
    """
    Call Bedrock model (Anthropic Claude) with the given input and prompt

    Args:
        input_text (str): The user input text to process
        prompt (str, optional): Custom prompt to use. If None, uses environment variable

    Returns:
        str: The generated content from Bedrock
    """
    try:
        # Use provided prompt or get from environment variable
        if prompt is None:
            config = get_prompts_config()
            bedrock_prompt = config['prompts']['base']['bedrock_prompt']
        else:
            bedrock_prompt = prompt

        full_prompt = f"{bedrock_prompt}: {input_text}"

        # Construct Claude-compatible request body
        request_body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2054,
            "top_p": 0.999,
            "top_k": 250,
            "system": "Vous êtes un expert en management de la qualité spécialisé dans l'expérience client (CX). Répondez exclusivement en français avec une approche professionnelle et technique. Fournissez des réponses directes sans introduction inutile ni formatage markdown. Pour les listes, utilisez uniquement les balises HTML (<ul>, <li>, <ol>). Concentrez-vous sur des insights actionnables, des méthodologies concrètes et des bonnes pratiques terrain. Évitez les généralités et privilégiez l'expertise sectorielle",
            "temperature": 0.7,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": full_prompt
                        }
                    ]
                }
            ]
        })

        # Send request
        response = bedrock_runtime.invoke_model(
            modelId="anthropic.claude-3-5-haiku-20241022-v1:0",
            contentType="application/json",
            accept="application/json",
            body=request_body.encode('utf-8')
        )

        # Parse response
        response_body = json.loads(response['body'].read())
        content = response_body['content'][0]['text']

        cleaned_content = clean_response(content)
        return cleaned_content

    except Exception as e:
        logger.error(f"Error invoking Bedrock: {str(e)}")
        raise e


def lambda_handler(event, context):
    """
    Main Lambda handler function
    
    Args:
        event (dict): Lambda event data
        context: Lambda context
        
    Returns:
        dict: Response containing Bedrock results
    """
    try:
        logger.info(f"Received event: {json.dumps(event)}")

        config = get_prompts_config()
        prompts = config['prompts']
        
        # Extract input text from the event
        input_text = event.get('originalText', '')
        file_name_key = event.get('fileNameKey', '')
        analysis = event.get('analysis', '')
        
        if not input_text:
            return {
                'statusCode': 400,
                'body': 'Missing originalText in request',
                'fileNameKey': file_name_key,
            }
        
        # Utiliser les prompts du fichier JSON au lieu des variables d'environnement
        satisfaction_score = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['satisfaction_score']
        )
        
        time_adequacy_score = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['time_adequacy_score']
        )
        
        assistance_adequacy_score = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['assistance_adequacy_score']
        )
        
        easy_of_resolution_score = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['easy_of_resolution_score']
        )
        
        net_promoter_score = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['net_promoter_score']
        )
        
        satisfaction_verbatim = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['satisfaction_verbatim']
        )
        
        dissatisfaction_verbatim = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['dissatisfaction_verbatim']
        )
        
        resolution_status = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['resolution_status']
        )
        
        main_improvement_suggestion = invoke_bedrock(
            input_text, 
            prompt=prompts['post_call_survey']['main_improvement_suggestion']
        )
        
        conversation_analysis = invoke_bedrock(
            input_text, 
            prompt=prompts['advanced_analysis']['conversation_analysis']
        )

        return {
            'statusCode': 200,
            'bedrockResult': {
                'satisfaction_globale': satisfaction_score,
                'time_adequacy': time_adequacy_score,
                'assistance_adequacy': assistance_adequacy_score,
                'easy_of_response': easy_of_resolution_score,
                'net_promoter': net_promoter_score,
                'satisfaction_verbatim': satisfaction_verbatim,
                'dissatisfaction_verbatim': dissatisfaction_verbatim,
                'resolution_prompt_status': resolution_status,
                'main_improvement_suggestions': main_improvement_suggestion,
                'conversation_analysis': json.loads(conversation_analysis),
            },
            'fileNameKey': file_name_key,
            'analysis': analysis,
        }
        
    except KeyError as e:
        logger.error(f"Missing required environment variable: {str(e)}")
        return {
            'statusCode': 500,
            'body': f"Configuration error: {str(e)}",
            'fileNameKey': file_name_key,
            'analysis': analysis,
        }
    
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            'statusCode': 500,
            'body': f"Error: {str(e)}"
        }