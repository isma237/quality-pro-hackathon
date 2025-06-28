const AWS = require('aws-sdk');
const stepfunctions = new AWS.StepFunctions();
const dynamodb = new AWS.DynamoDB.DocumentClient();


const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;
const TABLE_NAME = process.env.TABLE_NAME;
const region = process.env.AWS_REGION || 'us-west-2';

exports.handler = async (event) => {
  console.log('Event SQS reçu :', JSON.stringify(event));
  if (!STATE_MACHINE_ARN) {
    throw new Error('La variable d\'environnement STATE_MACHINE_ARN est requise');
  }

  let bucket = '';
  let key = '';
  // Pour chaque message SQS, démarrer une exécution Step Function
  const executions = await Promise.all(event.Records.map(async (record) => {
    let input;
    try {
      input = JSON.parse(record.body);
    } catch (e) {
      console.warn('Le body du message SQS n\'est pas un JSON valide, utilisation brute.');
      input = record.body;
    }

    // Extraction du nom de fichier selon la structure attendue
    let fileName = '';
    let campaignId = '';

    if (input.Records && input.Records[0] && input.Records[0].s3 && input.Records[0].s3.object) {
      bucket = input.Records?.[0]?.s3?.bucket?.name;
      key = input.Records[0].s3.object.key;
      console.log('Clé S3 reçue:', key);

      if (key.includes('/audio/')) {
        const parts = key.split('/audio/');
        if (parts.length === 2) {
          campaignId = parts[0];
          fileName = parts[1];
          console.log(`Extraction réussie - CampaignId: "${campaignId}", FileName: "${fileName}"`);


          const campaignRecord = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: {
              Id: campaignId,
              METADATA: `CAMPAIGN#${campaignId}`
            }
          }).promise();
    
          if (!campaignRecord.Item) {
            console.warn(`Campagne non trouvée dans la base de données: ${campaignId}`);
            throw new Error('CAMPAIGN_NOT_FOUND');
          }

          const audioEntry = {
            TableName: TABLE_NAME,
            Item: {
                Id: fileName,
                METADATA: `AUDIO#${campaignId}`,
                audioLinkUrl: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
                createdAt: new Date().toISOString(),
                fileName: fileName,
                campaign_type: campaignRecord.Item.campaign_type,
                s3Path: key
            }
          };

          console.log("Data de l'entrée audio dans DynamoDB:", audioEntry.Item);

          try {
            await dynamodb.put(audioEntry).promise();
            console.log('Audio enregistré avec succès:', audioEntry.Item);
          } catch (error) {
              console.error('Erreur lors de l\'enregistrement de l\'audio:', error);
              throw error;
          }


        } else {
          console.warn('Format de chemin S3 invalide:', key);
          return null;
        }
      } else {
        console.warn('Dossier /audio/ non trouvé dans le chemin:', key);
        return null;
      }
    } else {
      console.warn('Données S3 manquantes dans l\'événement');
      return null;
    }

    const audioRegex = /\.(wav|mp3|mp4|flac|ogg|m4a)$/i;
    if (!audioRegex.test(fileName)) {
      console.log(`Fichier ignoré (extension non supportée) : ${fileName}`);
      return null;
    }

    
    try {

      const audioRecord = await dynamodb.get({
        TableName: TABLE_NAME,
        Key: {
          Id: fileName,
          METADATA: `AUDIO#${campaignId}`
        }
      }).promise();

      if (!audioRecord.Item) {
        console.warn(`Audio non trouvé dans la base de données: ${fileName}`);
        // Retourner une erreur pour que SQS conserve le message
        throw new Error('AUDIO_NOT_FOUND');
      }

      const enrichedInput = {
        ...input,
        metadata: {
          fileName,
          campaignId,
          startTime: new Date().toISOString()
        }
      };

      const params = {
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify(enrichedInput)
      };
      console.log('Démarrage de la Step Function avec l\'input :', params.input);
    
      const result = await stepfunctions.startExecution(params).promise();
      console.log('Step Function démarrée :', result.executionArn);

      const executionId = result.executionArn.split(':').pop();

      await dynamodb.update({
        TableName: TABLE_NAME,
        Key: {
          Id: fileName,
          METADATA: `AUDIO#${campaignId}`
        },
        ConditionExpression: 'attribute_exists(Id)',
        UpdateExpression: 'SET executionId = :execId, analysisStatus = :status, analysisMetadata = :metadata',
        ExpressionAttributeValues: {
          ':execId': executionId,
          ':status': 'EN_COURS',
          ':metadata': {
            startTime: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          }
        }
      }).promise();

      return {
        executionId,
        audioId: `AUDIO#${fileName}`,
        campaignId,
        status: 'EN_COURS',
        bucket,
        key
      };

    } catch (err) {
      if (err.message === 'AUDIO_NOT_FOUND') {
        return null;
      }
      console.error('Erreur lors du démarrage de la Step Function :', err);
      throw err;
    }
  }));

  return { startedExecutions: executions };
};