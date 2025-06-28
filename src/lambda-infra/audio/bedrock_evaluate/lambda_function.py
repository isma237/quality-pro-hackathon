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
        bedrock_prompt = prompt or os.environ['BEDROCK_PROMPT']
        full_prompt = f"{bedrock_prompt} : {input_text}"

        # Construct Claude-compatible request body
        request_body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2024,
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
        
        # Call Bedrock using our helper function
        prompt_actions_agent = invoke_bedrock(input_text, prompt=os.environ['PromptActionAgent'])
        prompt_evaluation_qualite = invoke_bedrock(input_text, prompt=os.environ['PromptEvaluationQualite'])
        prompt_evaluation_politesse = invoke_bedrock(input_text, prompt=os.environ['PromptEvaluationPolitesse'])
        prompt_identification_produit = invoke_bedrock(input_text, prompt=os.environ['PromptIdentificationProduit'])
        prompt_identification_sujet = invoke_bedrock(input_text, prompt=os.environ['PromptIdentificationSujet'])
        prompt_necessite_rappel = invoke_bedrock(input_text, prompt=os.environ['PromptNecessiteRappel'])
        prompt_probleme_client = invoke_bedrock(input_text, prompt=os.environ['PromptProblemeClient'])
        prompt_resultats_conversation = invoke_bedrock(input_text, prompt=os.environ['PromptResultatsConversation'])
        prompt_resume_general = invoke_bedrock(input_text, prompt=os.environ['PromptResumeGeneral'])
        prompt_statut_resolution = invoke_bedrock(input_text, prompt=os.environ['PromptStatutResolution'])
        prompt_bilan_global = invoke_bedrock(input_text, prompt=os.environ['PromptBilanGlobal'])

        
        return {
            'statusCode': 200,
            'bedrockResult': {
                'prompt_actions_agent': prompt_actions_agent,
                'prompt_evaluation_qualite': prompt_evaluation_qualite,
                'prompt_evaluation_politesse': prompt_evaluation_politesse,
                'prompt_identification_produit': prompt_identification_produit,
                'prompt_identification_sujet': prompt_identification_sujet,
                'prompt_necessite_rappel': prompt_necessite_rappel,
                'prompt_probleme_client': prompt_probleme_client,
                'prompt_resultats_conversation': prompt_resultats_conversation,
                'prompt_resume_general': prompt_resume_general,
                'prompt_statut_resolution': prompt_statut_resolution,
                'prompt_bilan_global': prompt_bilan_global,
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