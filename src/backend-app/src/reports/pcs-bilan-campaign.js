
const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const {
    CALL_POST_SURVEY,
    calculateNPS,
    calculateCSAT,
    calculateAverageChurnProbability,
    calculateAverageEaseOfResponse,
    calculateAverageAssistanceAdequacy,
    countAnalysisStatus,
    invokeBedrockWithClaude
} = require('./lib');

exports.handler = async (event) => {
    console.log('Event reçu:', JSON.stringify(event));

    // Configuration CORS pour les réponses
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
    };
    
    // Gestion des requêtes OPTIONS pour CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: headers,
            body: ''
        };
    }

    try {
        const campaignId = event.pathParameters.campaignId;
        console.log(`Génération CSV pour campagne ${campaignId}`);

        const campaignParams = {
            TableName: process.env.TABLE_NAME,
            Key: {
                Id: campaignId,
                METADATA: `CAMPAIGN#${campaignId}`,
            }
        };
        
        const campaignResult = await dynamoDB.get(campaignParams).promise();
        
        if (!campaignResult.Item) {
            return {
                statusCode: 404,
                headers: headers,
                body: JSON.stringify({ message: 'Campagne non trouvée' })
            };
        }
        
        const campaign = campaignResult.Item;
        console.log(`Campagne trouvée - Type: ${campaign.campaign_type}, Nom: ${campaign.name}`);
        
        // Requête DynamoDB pour récupérer tous les audios de la campagne
        const audioParams = {
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: 'METADATA = :metadata',
            FilterExpression: 'analysisStatus = :status',
            ExpressionAttributeValues: {
                ':metadata': `AUDIO#${campaignId}`,
                ':status': 'COMPLETE'
            },
            IndexName: 'MetadataIndex'
        };
        const result = await dynamoDB.query(audioParams).promise();

        if (!result.Items || result.Items.length === 0) {
            return {
                statusCode: 404,
                headers: headers,
                body: JSON.stringify({ message: 'Aucun audio trouvé pour cette campagne' })
            };
        }
        let audioAnalysisData = extractAudioAnalysisData(result.Items, campaign.campaign_type);
        if (audioAnalysisData.length === 0) {
            return {
                statusCode: 404,
                headers: headers,
                body: JSON.stringify({ message: 'Aucune donnée d\'analyse audio trouvée pour cette campagne' })
            };
        }


        const prompt = `
            Tu es un assistant d’analyse de données de satisfaction client.
            À partir du tableau JSON suivant (voir la clé "analysisData"), analyse l’ensemble de la campagne et retourne :

            Le sentiment global de la campagne (positif, neutre ou négatif).
            Le nombre de verbatims à dominante positive, neutre et négative (basé sur le champ "dominantSentiment").
            Les verbatims positifs et négatifs principaux (champ "satisfactionVerbatim"). 10 pour mainPositiveVerbatims et 10 pour mainNegativeVerbatims.
            Le volume de résolution : nombre et pourcentage de statuts "Resolu", "Partiellement resolu" et "Non resolu" (champ "resolutionPromptStatus").
            A la suite de chaque mainNegatiVerbatims, ajoute "|" et l'identifiant de l'audio correspondant (champ "id").
            Réponds uniquement au format JSON suivant :

            {
                "globalSentiment": "positif | neutre | negatif",
                "sentimentVolume": {
                    "positive": 0,
                    "neutral": 0,
                    "negative": 0
                },
                "mainPositiveVerbatims": [
                    "verbatim positif 1",
                    "verbatim positif 2",
                
                ],
                "mainNegativeVerbatims": [
                    "verbatim negatif 1 | id_audio_1",
                    "verbatim negatif 2 | id_audio_2"
                ],
                "resolutionVolume": {
                    "resolu": {
                    "count": 0,
                    "percentage": 0
                    },
                    "partiellement_resolu": {
                    "count": 0,
                    "percentage": 0
                    },
                    "non_resolu": {
                    "count": 0,
                    "percentage": 0
                    }
                }
            }
            Ne génère rien d'autre que cet objet JSON. Pas d'introduction, pas de conclusion, pas d'explications.`

        const npsData = calculateNPS(audioAnalysisData);
        const csatData = calculateCSAT(audioAnalysisData);
        const averageChurnProbability = calculateAverageChurnProbability(audioAnalysisData);
        const averageEaseOfResponse = calculateAverageEaseOfResponse(audioAnalysisData);
        const adequacyScore = calculateAverageAssistanceAdequacy(audioAnalysisData);
        const analysisStatusCount = countAnalysisStatus(audioAnalysisData);
        const bedrockResult = await invokeBedrockWithClaude(audioAnalysisData, prompt, 'post-call-survey');

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Données d\'analyse audio récupérées avec succès',
                data: {
                    nps: npsData,
                    csat: csatData,
                    averageChurnProbability: averageChurnProbability,
                    averageEaseOfResponse: averageEaseOfResponse,
                    adequacyScore: adequacyScore,
                    analysisStatusCount: analysisStatusCount,
                    bedrockAnalysis: JSON.parse(bedrockResult),
                }
            })
        };

    } catch (error) {
        console.error('Erreur lors de la génération du CSV:', error);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: 'Erreur interne du serveur' })
        };
        
    }
}

/**
 * Extraire les données d'analyse audio en fonction du type de campagne
 * @param {Array} items - Liste des éléments audio à analyser
 * @param {string} campaignType - Type de campagne
 * @returns {Array} - Tableau d'objets contenant les données d'analyse
 */
function extractAudioAnalysisData(items, campaignType) {
    if (!items || !items.length) return [];
    
    const analysisData = [];
    
    if (campaignType === CALL_POST_SURVEY) {
        items.forEach(item => {
            const bedrockResult = item.bedrockResult || {};
            const conversationAnalysis = bedrockResult.conversation_analysis || {};
            const riskAssessment = conversationAnalysis.risk_assessment || {};
            const conversationMetrics = conversationAnalysis.conversation_metrics || {};
            const verbatims = conversationAnalysis.verbatims || {};
                    
            const row = {
                id: item.Id || '',
                createdAt: item.createdAt || '',
                analysisStatus: item.analysisStatus || '',
                satisfactionGlobale: bedrockResult.satisfaction_globale || '',
                netPromoter: bedrockResult.net_promoter || '',
                assistanceAdequacy: bedrockResult.assistance_adequacy || '',
                easyOfResponse: bedrockResult.easy_of_response || '',
                timeAdequacy: bedrockResult.time_adequacy || '',
                resolutionPromptStatus: bedrockResult.resolution_prompt_status || '',
                churnRiskLevel: riskAssessment.churnrisklevel || '',
                churnProbability: riskAssessment.churn_probability || '',
                dominantSentiment: conversationMetrics.dominant_sentiment || '',
                agentTalkRatio: conversationMetrics.agenttalkratio || '',
                interruptionCount: conversationMetrics.interruption_count || '',
                peakEmotion: conversationMetrics.peak_emotion || '',
                satisfactionVerbatim: bedrockResult.satisfaction_verbatim || '',
                criticalStatement: verbatims.critical_statement || '',
                positiveHighlight: verbatims.positive_highlight || '',
                improvementSuggestions: bedrockResult.main_improvement_suggestions || '',
                urgentCallbackRequired: riskAssessment.urgentcallbackrequired || ''
            };
            analysisData.push(row);
        });
    } else {
        // Gestion d'autres types de campagnes si nécessaire
        console.log(`Type de campagne non géré: ${campaignType}`);
    }
    
    return analysisData;
}