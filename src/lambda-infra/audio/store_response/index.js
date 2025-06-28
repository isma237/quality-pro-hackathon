const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
    const TABLE_NAME = process.env.TABLE_NAME;
    console.log('Event reçu:', JSON.stringify(event));

    // Initialisation des données de monitoring pour Step Functions
    if (!event.monitoring) {
        event.monitoring = {};
    }
    if (!event.monitoring.storage) {
        event.monitoring.storage = {
            start: new Date().toISOString()
        };
    }

    let campaignId, fileName;

    const fileNameKey = event.fileNameKey;
    const bedrockResult = event.bedrockResult || {};
    const analysis = event.analysis || {};

    if (!fileNameKey) {
        console.error('fileNameKey manquant dans l\'événement');
        return {
            statusCode: 400,
            body: 'fileNameKey missing in event',
            monitoring: event.monitoring
        };
    }

    // Extraction campaignId et fileName
    if (fileNameKey.includes('/audio/')) {
        const parts = fileNameKey.split('/audio/');
        if (parts.length === 2) {
            campaignId = parts[0];
            fileName = parts[1];
            console.log(`Extraction réussie - CampaignId: "${campaignId}", FileName: "${fileName}"`);
        } else {
            console.warn('Format de chemin S3 invalide:', fileNameKey);
            return {
                statusCode: 400,
                body: 'Invalid S3 path format',
                monitoring: event.monitoring
            };
        }
    } else if (event.campaignId) {
        campaignId = event.campaignId;
        fileName = fileNameKey;
        console.log(`Utilisation directe - CampaignId: "${campaignId}", FileName: "${fileName}"`);
    } else {
        console.warn('Impossible de déterminer le campaignId');
        return {
            statusCode: 400,
            body: 'Could not determine campaignId',
            monitoring: event.monitoring
        };
    }

    try {
        // Gestion d'une erreur d'analyse (Comprehend ou autre)
        if (event.ComprehendError || event.EvaluateCallMiningError || event.EvaluatePostCallError) {
            // Déterminer le message d'erreur approprié
            let errorDetail = event.ComprehendError || 
                              event.EvaluateCallMiningError || 
                              event.EvaluatePostCallError || 
                              'Unknown error occurred';
                              
            let errorSource = event.ComprehendError ? 'Comprehend' : 
                            event.EvaluateCallMiningError ? 'CallMining' : 
                            event.EvaluatePostCallError ? 'PostCall' : 'Unknown';

            const errorParams = {
                TableName: TABLE_NAME,
                Key: {
                    Id: fileName,
                    METADATA: `AUDIO#${campaignId}`
                },
                UpdateExpression: 'SET analysisStatus = :status, errorDetail = :error, errorSource = :source, lastUpdated = :now',
                ExpressionAttributeValues: {
                    ':status': 'FAILED',
                    ':error': errorDetail,
                    ':source': errorSource,
                    ':now': new Date().toISOString()
                },
                ReturnValues: 'UPDATED_NEW'
            };

            const errorResult = await dynamodb.update(errorParams).promise();
            console.log(`Mise à jour DynamoDB en échec réussie (${errorSource}):`, JSON.stringify(errorResult));

            event.monitoring.storage.end = new Date().toISOString();
            
            return {
                statusCode: 200,
                body: `Response stored as FAILED (${errorSource})`,
                updatedAttributes: errorResult.Attributes,
                monitoring: event.monitoring
            };
        } else {
            // CAS NOMINAL - Traitement normal lorsqu'aucune erreur n'est détectée
            const params = {
                TableName: TABLE_NAME,
                Key: {
                    Id: fileName,
                    METADATA: `AUDIO#${campaignId}`
                },
                UpdateExpression: 'SET analysisStatus = :status, analysis = :analysis, bedrockResult = :bedrockResult, lastUpdated = :now',
                ExpressionAttributeValues: {
                    ':status': 'COMPLETE',
                    ':analysis': analysis || {},
                    ':bedrockResult': bedrockResult || {},
                    ':now': new Date().toISOString()
                },
                ReturnValues: 'UPDATED_NEW'
            };

            const result = await dynamodb.update(params).promise();
            console.log('Mise à jour DynamoDB réussie:', JSON.stringify(result));

            // Ajout de l'horodatage de fin pour le monitoring
            event.monitoring.storage.end = new Date().toISOString();
            
            return {
                statusCode: 200,
                body: 'Response stored as COMPLETED',
                updatedAttributes: result.Attributes,
                monitoring: event.monitoring
            };
        }
    } catch (error) {
        console.error('Error storing response:', error);
        
        // Même en cas d'erreur, on retourne les informations de monitoring
        if (event.monitoring && event.monitoring.storage) {
            event.monitoring.storage.end = new Date().toISOString();
        }
        
        return {
            statusCode: 500,
            body: 'Failed to store response',
            error: error.message,
            monitoring: event.monitoring
        };
    }
};