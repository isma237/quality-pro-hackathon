#!/bin/bash

# Environment variables
UNIQUE_ID=$(date +%s | cut -c 6-10)
ENV_TYPE="isma-dev"
DEPLOYMENT_BUCKET="quality-pro-deployment-artifacts-$(date +%s)"
STACK_NAME="quality-pro-stack-${ENV_TYPE}-${UNIQUE_ID}"
SAM_STACK_NAME="quality-pro-backend-${ENV_TYPE}-${UNIQUE_ID}"
PROJECT_NAME="quality-pro-cmr"
OWNER="ismael-gadji-cmr"

# Dynamic settings for SAM deployment
BUCKET_NAME="quality-pro-audio-${ENV_TYPE}-${UNIQUE_ID}"
STATE_MACHINE_NAME="file-processing-statemachine-${ENV_TYPE}-${UNIQUE_ID}"
DYNAMO_TABLE_NAME="CampaignsTable-${ENV_TYPE}-${UNIQUE_ID}"

echo "=== Deployment Setup ==="
echo "Stack CloudFormation: $STACK_NAME"
echo "Stack SAM: $SAM_STACK_NAME"
echo "Bucket S3: $BUCKET_NAME"
echo "State Machine: $STATE_MACHINE_NAME"
echo "Table DynamoDB: $DYNAMO_TABLE_NAME"


# Create temporary S3 bucket for deployment
echo "=== Creating temporary S3 bucket for deployment ==="
aws s3 mb s3://$DEPLOYMENT_BUCKET

cd src/lambda-infra/audio
export LAMBDA_ARTIFACTS_BUCKET="$DEPLOYMENT_BUCKET"
chmod +x publish_lamba.sh
./publish_lamba.sh
cd ../../../cloudformation

# Check CloudFormation stack status
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")

# If stack failed before, delete it first
if [ "$STACK_STATUS" == "ROLLBACK_COMPLETE" ]; then
  echo "Stack failed before. Removing old stack..."
  aws cloudformation delete-stack --stack-name $STACK_NAME
  echo "Waiting for stack deletion to complete..."
  aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME
  echo "Old stack removed successfully."
fi


# Package CloudFormation template (upload local files to S3)
echo "=== Packaging CloudFormation templates ==="
aws cloudformation package \
  --template-file stack-quality-pro-ai.yaml \
  --s3-bucket $DEPLOYMENT_BUCKET \
  --output-template-file packaged-template.yml

# Deploy CloudFormation stack
echo "=== Deploying CloudFormation stack ==="
aws cloudformation deploy \
  --template-file packaged-template.yml \
  --stack-name $STACK_NAME \
  --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --parameter-overrides Environment=$ENV_TYPE DeploymentId=$UNIQUE_ID Project=$PROJECT_NAME Owner=$OWNER AudioBucketName=$BUCKET_NAME StateMachineName=$STATE_MACHINE_NAME TABLENAME=$DYNAMO_TABLE_NAME BucketForLambdaArtefact=$DEPLOYMENT_BUCKET

# Check if CloudFormation deployment was successful
if [ $? -ne 0 ]; then
  echo "CloudFormation deployment failed. Stopping script."
  exit 1
fi

echo "CloudFormation stack deployed successfully!"

# Get CloudFormation stack outputs if needed
QUEUE_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='FileProcessingQueueUrl'].OutputValue" --output text)

# Deploy SAM application
echo "=== Deploying SAM application ==="
cd ../src/backend-app

# Build SAM application
echo "Building SAM application..."
sam build

# Deploy with configuration settings
echo "Deploying SAM application with parameters..."
sam deploy \
  --stack-name $SAM_STACK_NAME \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    StateMachineName=$STATE_MACHINE_NAME \
    BucketName=$BUCKET_NAME \
    DynamoDbTable=$DYNAMO_TABLE_NAME \
  --s3-bucket $DEPLOYMENT_BUCKET

# Check if SAM deployment was successful
if [ $? -eq 0 ]; then
  echo "SAM deployment successful!"
  
  # Show outputs from both stacks
  echo "=== CloudFormation Stack Outputs ==="
  aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs" --output table
  
  echo "=== SAM Stack Outputs ==="
  aws cloudformation describe-stacks --stack-name $SAM_STACK_NAME --query "Stacks[0].Outputs" --output table
  
  # Save important deployment information
  echo "=== Deployment Information ==="
  echo "CloudFormation Stack: $STACK_NAME"
  echo "SAM Stack: $SAM_STACK_NAME"
  echo "S3 Bucket: $BUCKET_NAME"
  echo "DynamoDB Table: $DYNAMO_TABLE_NAME"
  echo "State Machine: $STATE_MACHINE_NAME"
  
else
  echo "SAM deployment failed. Check logs for more details."
fi