const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME;



exports.handler = async (event) => {

    const { campaignId } = event.pathParameters || {};
    if (event.httpMethod !== 'POST') {
        throw new Error(`postMethod only accepts POST method, you tried: ${event.httpMethod} method.`);
    }
    // All log statements are written to CloudWatch
    console.info('received:', event);

    // Get id and name from the body of the request
    const body = JSON.parse(event.body);
    const {fileName, duration, audioLinkUrl} = body
    try {

        const campaignParams = {
            TableName: tableName,
            Key: {
                Id: campaignId,
                METADATA: `CAMPAIGN#${campaignId}`
            }
        };

        const { Item } = await ddbDocClient.send(new GetCommand(campaignParams));
        
        if (!Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: "La campagne demandée n'existe pas. Vous devez la créer avant de procéder à l'ajout des audios" })
            };
        }

        var params = {
            TableName : tableName,
            Item: { 
                Id : fileName,
                createdAt: new Date().toISOString(),
                duration,
                audioLinkUrl,
                METADATA : `AUDIO#${campaignId}`,
                s3Path: `${campaignId}/audio/${fileName}`
            }
        };

        const data = await ddbDocClient.send(new PutCommand(params));
        console.log("Success - item added or updated", data);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            body: JSON.stringify(params.Item)
        };
    } catch (error) {
        console.log("Error", error.stack);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            body: JSON.stringify({ error: error.message })
        };
    }
}