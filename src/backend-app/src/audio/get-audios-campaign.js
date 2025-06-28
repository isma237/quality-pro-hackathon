const AWS = require('aws-sdk');
const stepfunctions = new AWS.StepFunctions();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN

const HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
const POST_CALL_SURVEY = 'Post Call Survey';

exports.handler = async (event) => {
    const { campaignId } = event.pathParameters;
    console.log("campaignId", campaignId);  

    try {

        const campaignParams = {
            TableName: TABLE_NAME,
            Key: {
                Id: campaignId,
                METADATA: `CAMPAIGN#${campaignId}`
            }
        }

        const campaignResult = await dynamodb.get(campaignParams).promise();
        const campaignInfo = campaignResult.Item;

        const params = {
            TableName: TABLE_NAME,
            IndexName: 'MetadataIndex', // Remplace par le nom réel de ton GSI
            KeyConditionExpression: 'METADATA = :metadata',
            ExpressionAttributeValues: {
                ':metadata': `AUDIO#${campaignId}`
            }
        };

        const result = await dynamodb.query(params).promise();
        const audiosRecords = result.Items;

        let audios = await Promise.all(
            audiosRecords.map(async (audioRecord) => {
                const { executionId } = audioRecord;
                // 2. Vérifier le statut de la Step Function
                const execution = await stepfunctions.describeExecution({
                    executionArn: `${STATE_MACHINE_ARN}:${executionId}`
                }).promise();

                let bedrockAnalysis = {};
                if (execution.status === 'SUCCEEDED') {
                    // 4. Construire bedrockAnalysis
                    if (audioRecord.analysisStatus === 'COMPLETE') {
                        if (audioRecord.campaign_type === POST_CALL_SURVEY) {
                            bedrockAnalysis['satisfaction_globale'] = audioRecord.bedrockResult?.satisfaction_globale;
                            bedrockAnalysis['net_promoter'] = audioRecord.bedrockResult?.net_promoter;
                            bedrockAnalysis['churnrisklevel'] = audioRecord.bedrockResult?.conversation_analysis?.risk_assessment.churnrisklevel;
                        } else {
                            bedrockAnalysis['prompt_identification_sujet'] = audioRecord.bedrockResult?.prompt_identification_sujet;
                            bedrockAnalysis['prompt_statut_resolution'] = audioRecord.bedrockResult?.prompt_statut_resolution;
                            if (audioRecord.bedrockResult?.prompt_bilan_global) {
                                try {
                                    const prompt_bilan_global = JSON.parse(audioRecord.bedrockResult.prompt_bilan_global);
                                    bedrockAnalysis['scoreglobalsur_10'] = prompt_bilan_global.scoreglobalsur_10;
                                } catch (e) {
                                    bedrockAnalysis['scoreglobalsur_10'] = null;
                                }
                            }
                        }
                    }else{
                        // Extraire les détails d'erreur si disponibles
                        if (audioRecord.errorDetail) {
                            try {
                                // Si errorDetail.Cause est une chaîne JSON
                                if (audioRecord.errorDetail.Cause) {
                                    const errorCause = JSON.parse(audioRecord.errorDetail.Cause);
                                    bedrockAnalysis['errorMessage'] = errorCause.errorMessage;
                                } else {
                                    bedrockAnalysis['errorMessage'] = audioRecord.errorDetail.Error || 'Unknown error';
                                }
                            } catch (e) {
                                bedrockAnalysis['errorMessage'] = audioRecord.errorDetail.Cause || 'Error parsing details';
                            }
                        }
                    }
                }

                return {
                    Id: audioRecord.Id,
                    audioUrl: audioRecord.s3Path,
                    status: audioRecord.analysisStatus,
                    bedrockAnalysis: bedrockAnalysis,
                    createdAt: audioRecord.createdAt,
                    executionId: audioRecord.execution,
                    analysisOutput: audioRecord.analysisOutput,
                };
            })
        );

        const sortedItems = audios.sort((a, b) => {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        
        return {
            statusCode: 200,
            headers: HEADERS,
            body: JSON.stringify({
                campaign : {
                    Id: campaignInfo.Id,
                    name: campaignInfo.name,
                    objective: campaignInfo.objective,
                    description: campaignInfo.description,
                    date: campaignInfo.date,
                    createdAt: campaignInfo.createdAt,
                    campaign_type: campaignInfo.campaign_type,
                    METADATA: `CAMPAIGN#${campaignInfo.Id}`,
                    updatedAt: campaignInfo.updatedAt
                },
                audios: {
                    count: audios.length,
                    items: sortedItems
                }
            })
        };
    }catch(error) {
        console.error('Erreur:', error);
        return {
          statusCode: 500,
          headers: HEADERS,
          body: JSON.stringify({ error: error.message })
        };
    }
}