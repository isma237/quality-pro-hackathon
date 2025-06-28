const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME;
const bucketName = process.env.BUCKET_NAME;

const HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
}


exports.handler = async (event) => {
    console.info('received:', event);

    const { campaignId, audioId } = event.pathParameters;

    try {
        // Paramètres pour requêter l'audio
        const audioParams = {
            TableName: tableName,
            Key: {
                Id: audioId,
                METADATA: `AUDIO#${campaignId}`
            }
        };

        const { Item: audio } = await ddbDocClient.send(new GetCommand(audioParams));

        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: audio.s3Path
        });
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1h

        // Remplacer l'url dans la réponse
        audio.presignedUrl = presignedUrl;

        if (!audio) {
            return {
                statusCode: 404,
                headers: HEADERS,
                body: JSON.stringify({ 
                    error: "L'audio demandé n'existe pas",
                    code: "AUDIO_NOT_FOUND"
                })
            };
        }

        return {
            statusCode: 200,
            headers: HEADERS,
            body: JSON.stringify(audio)
        };

    } catch (error) {
        console.error("Erreur lors de la récupération de l'audio:", error);
        return {
            statusCode: error.statusCode || 500,
            headers: HEADERS,
            body: JSON.stringify({ 
                error: "Erreur lors de la récupération de l'audio",
                code: error.code || 'INTERNAL_SERVER_ERROR',
                message: error.message,
                requestId: event.requestContext?.requestId
            })
        };
    }
}
