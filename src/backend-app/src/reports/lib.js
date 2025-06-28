const AWS = require('aws-sdk');
const bedrock = new AWS.BedrockRuntime({ region: 'us-west-2' });

// Constantes
const CALL_POST_SURVEY = 'Post Call Survey';

/**
 * Génère un CSV selon le type de campagne
 * @param {*} campaign 
 * @param {*} audioItems 
 * @returns {string} Contenu du fichier CSV
 */
function generateCsvByCampaignType(campaign, audioItems) {
    console.log(`Génération CSV pour campagne de type: ${campaign.campaign_type}`);

    if(campaign.campaign_type == CALL_POST_SURVEY) {
        return generatePostCallSurveyCsv(audioItems);
    }
    return generateEntryCallCsv(audioItems);
}

/**
 * Génère un CSV pour les sondages post-appel
 * @param {*} audioItems 
 * @returns {string} Contenu du fichier CSV
 */
function generatePostCallSurveyCsv(audioItems) {
    const headers = [
        'Audio ID',
        'Creation Date',
        'Analysis Status',
        'CSAT Score',
        'NPS Score',
        'Assistance Adequacy',
        'Response Ease (CES)',
        'Time Adequacy',
        'Resolution Status',
        'Churn Risk Level',
        'Churn Probability',
        'Dominant Sentiment',
        'Agent Talk Ratio',
        'Interruption Count',
        'Peak Emotion',
        'Satisfaction Verbatim',
        'Critical Statement',
        'Positive Highlight',
        'Improvement Suggestions',
        'Urgent Callback Required'
    ];
    
    let csv = '\uFEFF' + headers.join(';') + '\n';
    audioItems.forEach(item => {
        const bedrockResult = item.bedrockResult || {};
        const conversationAnalysis = bedrockResult.conversation_analysis || {};
        const riskAssessment = conversationAnalysis.risk_assessment || {};
        const conversationMetrics = conversationAnalysis.conversation_metrics || {};
        const verbatims = conversationAnalysis.verbatims || {};
                
        const row = [
            escapeCsv(item.Id || ''),
            escapeCsv(item.createdAt || ''),
            escapeCsv(item.analysisStatus || ''),
            escapeCsv(bedrockResult.satisfaction_globale || ''),
            escapeCsv(bedrockResult.net_promoter || ''),
            escapeCsv(bedrockResult.assistance_adequacy || ''),
            escapeCsv(bedrockResult.easy_of_response || ''),
            escapeCsv(bedrockResult.time_adequacy || ''),
            escapeCsv(bedrockResult.resolution_prompt_status || ''),
            escapeCsv(riskAssessment.churnrisklevel || ''),
            escapeCsv(riskAssessment.churn_probability || ''),
            escapeCsv(conversationMetrics.dominant_sentiment || ''),
            escapeCsv(conversationMetrics.agenttalkratio || ''),
            escapeCsv(conversationMetrics.interruption_count || ''),
            escapeCsv(conversationMetrics.peak_emotion || ''),
            escapeCsv(bedrockResult.satisfaction_verbatim || ''),
            escapeCsv(verbatims.critical_statement || ''),
            escapeCsv(verbatims.positive_highlight || ''),
            escapeCsv(bedrockResult.main_improvement_suggestions || ''),
            escapeCsv(riskAssessment.urgentcallbackrequired || '')
        ];
        
        csv += row.join(';') + '\n';
    });
    
    return csv;
}

/**
 * Génère un CSV pour les analyses d'appels entrants
 * @param {*} audioItems 
 * @returns {string} Contenu du fichier CSV
 */
function generateEntryCallCsv(audioItems) {
    console.log(`Génération CSV Analyse Appels Entrants - ${audioItems.length} items`);
    
    const headers = [
        'Audio ID',
        'Creation Date',
        'Analysis Status',
        'Overall Sentiment',
        'Positive Score (%)',
        'Negative Score (%)',
        'Neutral Score (%)',
        'Subject Identified',
        'Product/Service',
        'Client Problem',
        'Resolution Status',
        'Callback Required',
        'Politeness Evaluation',
        'Communication Clarity',
        'Global Quality Score (/10)',
        'Repetitions Detected',
        'Call Too Long',
        'Optimal Duration (min)',
        'Agent Actions Summary',
        'Conversation Results',
        'Improvement Suggestions',
    ];
    
    // BOM UTF-8 pour Excel
    let csv = '\uFEFF' + headers.join(';') + '\n';
    
    audioItems.forEach(item => {
        const analysisOutput = item.analysisOutput || {};
        const sentiment = analysisOutput.sentiment || {};
        const bedrockResult = item.bedrockResult || {};
        
        // Parser le bilan global s'il est en JSON
        let bilanGlobal = {};
        try {
            if (bedrockResult.prompt_bilan_global) {
                bilanGlobal = JSON.parse(bedrockResult.prompt_bilan_global);
            }
        } catch (e) {
            console.warn('Erreur parsing bilan global:', e);
        }
        
        // Calculer les pourcentages de sentiment
        const sentimentScores = sentiment.scores || {};
        const positivePercent = ((sentimentScores.Positive || 0) * 100).toFixed(1);
        const negativePercent = ((sentimentScores.Negative || 0) * 100).toFixed(1);
        const neutralPercent = ((sentimentScores.Neutral || 0) * 100).toFixed(1);
        
        const row = [
            escapeCsv(item.Id || ''),
            escapeCsv(item.createdAt || ''),
            escapeCsv(item.analysisStatus || ''),
            escapeCsv(sentiment.overall || ''),
            escapeCsv(positivePercent),
            escapeCsv(negativePercent),
            escapeCsv(neutralPercent),
            escapeCsv(normalizeYesNoResponse(bedrockResult.prompt_identification_sujet)),
            escapeCsv(bedrockResult.prompt_identification_produit || ''),
            escapeCsv(bedrockResult.prompt_probleme_client || ''),
            escapeCsv(normalizeYesNoResponse(bedrockResult.prompt_statut_resolution)),
            escapeCsv(normalizeYesNoResponse(bedrockResult.prompt_necessite_rappel)), 
            escapeCsv(normalizePolitenessResponse(bedrockResult.prompt_evaluation_politesse)),
            escapeCsv(bilanGlobal.clarte_concision?.valeur ? 'Oui' : 'Non'),
            escapeCsv(bilanGlobal.scoreglobalsur_10 || ''),
            escapeCsv(bilanGlobal.repetitions_detectees?.valeur ? 'Oui' : 'Non'),
            escapeCsv(bilanGlobal.appeltroplong?.valeur ? 'Oui' : 'Non'),
            escapeCsv(bilanGlobal.dureeestimeeoptimale_minutes || ''),
            escapeCsv(bedrockResult.prompt_actions_agent || ''),
            escapeCsv(bedrockResult.prompt_resultats_conversation || ''),
            escapeCsv(Array.isArray(bilanGlobal.suggestions_amelioration) ? 
                     bilanGlobal.suggestions_amelioration.join(', ') : ''),
        ];
        
        csv += row.join(';') + '\n';
    });
    
    return csv;
}

/**
 * Fonction utilitaire pour échapper les valeurs CSV
 */
function escapeCsv(value) {
    if (value === undefined || value === null) return '';
    let str = String(value);
    str = str
        .replace(/é/g, 'e')
        .replace(/è/g, 'e')
        .replace(/ê/g, 'e')
        .replace(/ë/g, 'e')
        .replace(/à/g, 'a')
        .replace(/á/g, 'a')
        .replace(/â/g, 'a')
        .replace(/ä/g, 'a')
        .replace(/ù/g, 'u')
        .replace(/ú/g, 'u')
        .replace(/û/g, 'u')
        .replace(/ü/g, 'u')
        .replace(/ç/g, 'c')
        .replace(/ô/g, 'o')
        .replace(/ö/g, 'o')
        .replace(/î/g, 'i')
        .replace(/ï/g, 'i');

    if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Normalise les réponses oui/non en format standardisé
 */
function normalizeYesNoResponse(value) {
    if (!value || typeof value !== 'string') return 'N/A';
    
    const cleanValue = value.toLowerCase().trim();
    
    // Réponses positives
    const positiveResponses = ['oui', 'yes', 'y', 'true', '1', 'resolu', 'résolu'];
    if (positiveResponses.some(response => cleanValue.includes(response))) {
        return 'Oui';
    }
    
    // Réponses négatives
    const negativeResponses = ['non', 'no', 'n', 'false', '0'];
    if (negativeResponses.some(response => cleanValue === response)) {
        return 'Non';
    }
    
    // Si c'est un texte long (erreur de transcript), retourner "Error"
    if (cleanValue.length > 110) {
        return 'Transcript Error';
    }
    
    // Valeur inconnue
    return 'Unknown';
}

/**
 * Normalise les réponses de politesse
 */
function normalizePolitenessResponse(value) {
    if (!value || typeof value !== 'string') return 'N/A';
    
    const cleanValue = value.toLowerCase().trim();
    
    // Rechercher des mots clés positifs
    if (cleanValue.includes('oui') || cleanValue.includes('yes') || 
        cleanValue.includes('poli') || cleanValue.includes('courtois') ||
        cleanValue.includes('professionnel')) {
        return 'Professional';
    }
    
    // Rechercher des mots clés négatifs
    if (cleanValue.includes('non') || cleanValue.includes('no') || 
        cleanValue.includes('impoli') || cleanValue.includes('unprofessional') ||
        cleanValue.includes('manque')) {
        return 'Unprofessional';
    }
    
    // Si c'est un texte d'erreur
    if (cleanValue.includes('transcript') || cleanValue.includes('manquant') ||
        cleanValue.includes('incomplet') || cleanValue.length > 50) {
        return 'Analysis Error';
    }
    
    return 'Unknown';
}

/**
 * Mapping simple pour les réponses courantes
 */
function standardizeResponse(value) {
    if (!value) return 'N/A';
    
    const responseMap = {
        'oui': 'Oui',
        'non': 'Non',
        'yes': 'Oui',
        'no': 'Non',
        'y': 'Oui',
        'n': 'Non',
        'true': 'Oui',
        'false': 'Non',
        'resolu': 'Oui',
        'résolu': 'Oui'
    };
    
    const cleanValue = String(value).toLowerCase().trim();
    
    // Retour direct si c'est dans le mapping
    if (responseMap[cleanValue]) {
        return responseMap[cleanValue];
    }
    
    // Si c'est un texte long, probablement une erreur
    if (cleanValue.length > 20) {
        return 'Error';
    }
    
    return cleanValue;
}


/**
 * Calcule le Net Promoter Score (NPS) à partir des données d'analyse audio
 * @param {Array} audioAnalysisData - Tableau des données d'analyse audio
 * @returns {Object} - Résultat du calcul NPS avec statistiques détaillées
 */
function calculateNPS(audioAnalysisData) {
    if (!audioAnalysisData || audioAnalysisData.length === 0) {
        return {
            npsScore: 0,
            promoters: 0,
            passives: 0,
            detractors: 0,
            promotersPercentage: 0,
            passivesPercentage: 0,
            detractorsPercentage: 0,
            totalResponses: 0,
            validResponses: 0
        };
    }

    // Compteurs
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    let validResponses = 0;
    const totalResponses = audioAnalysisData.length;

    // Parcourir les données pour classifier les réponses
    audioAnalysisData.forEach(item => {
        // Vérifier si la valeur NPS existe et est convertible en nombre
        const npsValue = parseInt(item.netPromoter);
        
        if (!isNaN(npsValue)) {
            validResponses++;
            
            if (npsValue >= 9 && npsValue <= 10) {
                promoters++;
            } else if (npsValue >= 7 && npsValue <= 8) {
                passives++;
            } else if (npsValue >= 0 && npsValue <= 6) {
                detractors++;
            }
        }
    });

    // Calcul des pourcentages (éviter division par zéro)
    const promotersPercentage = validResponses > 0 ? (promoters / validResponses) * 100 : 0;
    const passivesPercentage = validResponses > 0 ? (passives / validResponses) * 100 : 0;
    const detractorsPercentage = validResponses > 0 ? (detractors / validResponses) * 100 : 0;
    
    // Calcul du score NPS final (promoteurs % - détracteurs %)
    const npsScore = Math.round(promotersPercentage - detractorsPercentage);

    return {
        npsScore,
        promoters,
        passives,
        detractors,
        promotersPercentage: Math.round(promotersPercentage),
        passivesPercentage: Math.round(passivesPercentage),
        detractorsPercentage: Math.round(detractorsPercentage),
        totalResponses,
        validResponses
    };
}

/**
 * Calcule le score CSAT à partir des données d'analyse audio
 * @param {Array} audioAnalysisData - Tableau des données d'analyse audio
 * @returns {Object} - Résultat du calcul CSAT avec statistiques détaillées
 */
function calculateCSAT(audioAnalysisData) {
    if (!audioAnalysisData || audioAnalysisData.length === 0) {
        return {
            csatScore: 0,
            satisfied: 0,
            neutral: 0,
            dissatisfied: 0,
            satisfiedPercentage: 0,
            neutralPercentage: 0, 
            dissatisfiedPercentage: 0,
            totalResponses: 0,
            validResponses: 0
        };
    }

    // Compteurs
    let satisfied = 0;
    let neutral = 0;
    let dissatisfied = 0;
    let validResponses = 0;
    const totalResponses = audioAnalysisData.length;

    // Parcourir les données pour classifier les réponses
    audioAnalysisData.forEach(item => {
        // Vérifier si la valeur de satisfaction existe et est convertible en nombre
        const satisfactionValue = parseInt(item.satisfactionGlobale);
        
        if (!isNaN(satisfactionValue)) {
            validResponses++;
            
            // Classification standard CSAT: 4-5 = satisfait, 3 = neutre, 1-2 = insatisfait
            // (sur une échelle de 1 à 5)
            if (satisfactionValue >= 4) {
                satisfied++;
            } else if (satisfactionValue === 3) {
                neutral++;
            } else {
                dissatisfied++;
            }
        }
    });

    // Calcul des pourcentages (éviter division par zéro)
    const satisfiedPercentage = validResponses > 0 ? (satisfied / validResponses) * 100 : 0;
    const neutralPercentage = validResponses > 0 ? (neutral / validResponses) * 100 : 0;
    const dissatisfiedPercentage = validResponses > 0 ? (dissatisfied / validResponses) * 100 : 0;
    
    // Calcul du score CSAT (% de clients satisfaits - scores 4-5)
    const csatScore = Math.round(satisfiedPercentage);

    return {
        csatScore,
        satisfied,
        neutral,
        dissatisfied,
        satisfiedPercentage: Math.round(satisfiedPercentage),
        neutralPercentage: Math.round(neutralPercentage),
        dissatisfiedPercentage: Math.round(dissatisfiedPercentage),
        totalResponses,
        validResponses
    };
}

/**
 * Calcule la probabilité moyenne de churn à partir des données d'analyse audio
 * @param {Array} audioAnalysisData - Tableau des données d'analyse audio
 * @returns {number} - La probabilité moyenne de churn (entre 0 et 1)
 */
function calculateAverageChurnProbability(audioAnalysisData) {
    if (!audioAnalysisData || audioAnalysisData.length === 0) {
        return 0;
    }

    let totalChurnProbability = 0;
    let validResponses = 0;

    // Parcourir les données pour calculer la moyenne
    audioAnalysisData.forEach(item => {
        // Vérifier si la valeur de probabilité existe et est convertible en nombre
        const probability = parseFloat(item.churnProbability);
        
        if (!isNaN(probability)) {
            validResponses++;
            totalChurnProbability += probability;
        }
    });

    // Calcul de la probabilité moyenne
    return validResponses > 0 
        ? Math.round((totalChurnProbability / validResponses) * 100) / 100  // 2 décimales
        : 0;
}

/**
 * Calcule le score moyen de facilité de réponse
 * @param {Array} audioAnalysisData - Tableau des données d'analyse audio
 * @returns {number} - Score moyen de facilité de réponse
 */
function calculateAverageEaseOfResponse(audioAnalysisData) {
    if (!audioAnalysisData || audioAnalysisData.length === 0) {
        return 0;
    }

    let totalEaseScore = 0;
    let validResponses = 0;

    // Parcourir les données pour calculer la moyenne
    audioAnalysisData.forEach(item => {
        // Vérifier si la valeur existe et est convertible en nombre
        const easeScore = parseFloat(item.easyOfResponse);
        
        if (!isNaN(easeScore)) {
            validResponses++;
            totalEaseScore += easeScore;
        }
    });

    // Calcul de la moyenne
    return validResponses > 0 
        ? Math.round((totalEaseScore / validResponses) * 100) / 100  // 2 décimales
        : 0;
}

/**
 * Calcule le score moyen d'adéquation de l'assistance
 * @param {Array} audioAnalysisData - Tableau des données d'analyse audio
 * @returns {number} - Score moyen d'adéquation de l'assistance
 */
function calculateAverageAssistanceAdequacy(audioAnalysisData) {
    if (!audioAnalysisData || audioAnalysisData.length === 0) {
        return 0;
    }

    let totalAdequacyScore = 0;
    let validResponses = 0;

    // Parcourir les données pour calculer la moyenne
    audioAnalysisData.forEach(item => {
        // Vérifier si la valeur existe et est convertible en nombre
        const adequacyScore = parseFloat(item.assistanceAdequacy);
        
        if (!isNaN(adequacyScore)) {
            validResponses++;
            totalAdequacyScore += adequacyScore;
        }
    });

    // Calcul de la moyenne
    return validResponses > 0 
        ? Math.round((totalAdequacyScore / validResponses) * 100) / 100  // 2 décimales
        : 0;
}

/**
 * Analyse les statuts d'analyse audio et retourne un simple comptage
 * @param {Array} audioAnalysisData - Tableau des données d'analyse audio
 * @returns {Object} - Comptage simple des statuts complete et error
 */
function countAnalysisStatus(audioAnalysisData) {
    if (!audioAnalysisData || audioAnalysisData.length === 0) {
        return { complete: 0, error: 0 };
    }

    // Compteurs
    let complete = 0;
    let error = 0;

    // Parcourir les données pour compter les statuts
    audioAnalysisData.forEach(item => {
        if (item.analysisStatus === 'COMPLETE') {
            complete++;
        } else {
            error++;
        }
    });

    return {
        complete,
        error
    };
}

/**
 * Appelle Bedrock avec Claude Haiku 3.5 pour analyser les données filtrées
 *
 * @param {Array} items - Liste des données d'analyse audio
 * @param {string} promptTemplate - Modèle de prompt à utiliser
 * @returns {Promise<Object>} - Résultat de l'analyse Bedrock
 */
/*async function invokeBedrockWithClaude(items, promptTemplate) {
    try {
        // Filtrer les éléments avec analysisStatus à COMPLETE
        const filteredItems = items.filter(item => item.analysisStatus === 'COMPLETE');

        if (filteredItems.length === 0) {
            throw new Error('Aucun élément avec analysisStatus à COMPLETE.');
        }

        // Construire le prompt en utilisant les éléments filtrés
        const inputData = JSON.stringify({ analysisData: filteredItems });
        const fullPrompt = `${promptTemplate}\n\nVoici les données à analyser : ${inputData}`;

        // Construire le corps de la requête pour Bedrock
        const requestBody = JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 2048,
            top_p: 0.999,
            top_k: 350,
            stop_sequences: [],
            temperature: 0.7,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: fullPrompt
                        }
                    ]
                }
            ]
        });

        // Envoyer la requête à Bedrock
        const response = await bedrock.invokeModel({
            modelId: "anthropic.claude-3-5-haiku-20241022-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: requestBody
        }).promise();

        // Extraire et retourner le contenu de la réponse
        const responseBody = JSON.parse(response.body.toString());
        const content = responseBody.content[0].text;

        return { data: content };

    } catch (error) {
        console.error('Erreur lors de l\'appel à Bedrock :', error);
        return { error: error.message };
    }
}*/

/**
 * Appelle Bedrock avec Claude Haiku pour analyser différents types de données
 * 
 * @param {Array|Object|string} data - Données à analyser (peut être un tableau d'objets, un objet, ou une chaîne)
 * @param {string} promptTemplate - Template du prompt à utiliser
 * @param {string} [analysisType='generic'] - Type d'analyse pour le logging
 * @returns {Promise<Object>} - Résultat de l'analyse Bedrock
 */
async function invokeBedrockWithClaude(data, promptTemplate, analysisType = 'generic') {
    try {
        console.log(`Démarrage analyse Bedrock (${analysisType}) avec ${typeof data} données`);
        
        let processedData;
        
        if (Array.isArray(data)) {
            // Si c'est un tableau d'objets avec analysisStatus
            if (data.length > 0 && typeof data[0] === 'object' && 'analysisStatus' in data[0]) {
                processedData = data.filter(item => item.analysisStatus === 'COMPLETE');
                if (processedData.length === 0) {
                    throw new Error(`Aucun élément avec analysisStatus COMPLETE pour l'analyse ${analysisType}`);
                }
            } else {
                // Tableau de chaînes ou d'autres types
                processedData = data;
            }
        } else if (typeof data === 'object' && data !== null) {
            // Si c'est un objet unique
            processedData = data;
        } else {
            // Si c'est une chaîne ou un autre type primitif
            processedData = data;
        }

        // Construire le prompt en utilisant les données préparées
        let fullPrompt;
        if (typeof promptTemplate === 'object' && promptTemplate !== null) {
            // Si le template est déjà un objet, l'utiliser directement
            fullPrompt = promptTemplate;
        } else {
            // Sinon construire le prompt
            const inputData = JSON.stringify(processedData);
            fullPrompt = `${promptTemplate}\n\nVoici les données à analyser :\n${inputData}`;
        }

        // Construire le corps de la requête pour Bedrock
        const requestBody = JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4096,
            top_p: 0.999,
            top_k: 350,
            stop_sequences: [],
            temperature: 0.7,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: typeof fullPrompt === 'string' ? fullPrompt : JSON.stringify(fullPrompt)
                        }
                    ]
                }
            ]
        });

        console.log(`Envoi de la requête Bedrock pour ${analysisType}...`);
        
        // Envoyer la requête à Bedrock
        const response = await bedrock.invokeModel({
            modelId: "anthropic.claude-3-5-haiku-20241022-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: requestBody
        }).promise();

        // Extraire et retourner le contenu de la réponse
        const responseBody = JSON.parse(response.body.toString());
        const content = responseBody.content[0].text;

        console.log(`Analyse Bedrock (${analysisType}) complétée avec succès`);
        return content;

    } catch (error) {
        console.error(`Erreur lors de l'analyse Bedrock (${analysisType}):`, error);
        throw new Error(`Échec de l'analyse Bedrock: ${error.message}`);
    }
}

// Exporter toutes les fonctions nécessaires
module.exports = {
    CALL_POST_SURVEY,
    generateCsvByCampaignType,
    generatePostCallSurveyCsv,
    generateEntryCallCsv,
    escapeCsv,
    normalizeYesNoResponse,
    normalizePolitenessResponse,
    calculateCSAT,
    standardizeResponse,
    calculateNPS,
    calculateAverageChurnProbability,
    calculateAverageEaseOfResponse,
    calculateAverageAssistanceAdequacy,
    countAnalysisStatus,
    invokeBedrockWithClaude
};