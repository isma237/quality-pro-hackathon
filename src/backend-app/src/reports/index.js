
const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const {
    CALL_POST_SURVEY,
    generateCsvByCampaignType,
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

        const csvContent = generateCsvByCampaignType(campaign, result.Items);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `export_audios_${campaignId}_${timestamp}.csv`;

        // Enregistrer le fichier dans S3
        await s3.putObject({
            Bucket: process.env.BUCKET_NAME,
            Key: `exports/${fileName}`,
            Body: Buffer.from(csvContent, 'utf8'),
            ContentType: 'text/csv; charset=utf-8',
            ContentDisposition: `attachment; filename="${fileName}"`,
            Metadata: {
                'charset': 'utf-8'
            }
        }).promise();

        // Générer une URL de téléchargement présignée
        const downloadUrl = s3.getSignedUrl('getObject', {
            Bucket: process.env.BUCKET_NAME,
            Key: `exports/${fileName}`,
            Expires: 1800
        });

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Export des audios généré avec succès',
                filename: fileName,
                url: downloadUrl,
            })
        };
        
    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: 'Une erreur est survenue durant la generation du CSV', error })
        };
    }
}