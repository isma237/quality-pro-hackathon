#!/bin/bash

# Vérifier que la variable LAMBDA_ARTIFACTS_BUCKET est définie
if [ -z "$LAMBDA_ARTIFACTS_BUCKET" ]; then
    echo "❌ Erreur: La variable LAMBDA_ARTIFACTS_BUCKET n'est pas définie"
    echo "Usage: LAMBDA_ARTIFACTS_BUCKET=your-bucket-name ./publish_lamba.sh"
    exit 1
fi

echo "📦 Publishing Lambda functions to bucket: $LAMBDA_ARTIFACTS_BUCKET"

rm *.zip

cd transcript
zip -r ../transcript.zip .
cd ..

cd get_transcript
zip -r ../get_transcript.zip .
cd ..

cd stepfunction_trigger
zip -r ../stepfunction_trigger.zip .
cd ..

cd wait_for_transcribe
zip -r ../wait_for_transcribe.zip .
cd ..

cd comprehend
zip -r ../comprehend.zip .
cd ..

cd bedrock_evaluate
zip -r ../bedrock_evaluate.zip .
cd ..

cd store_response
zip -r ../store_response.zip .
cd ..

cd bedrock_evaluate_post_call_survey
zip -r ../bedrock_evaluate_post_call_survey.zip .
cd ..

echo "Uploading Lambda packages to S3..."


aws s3 cp transcript.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp get_transcript.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp stepfunction_trigger.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp wait_for_transcribe.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp comprehend.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp bedrock_evaluate.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp store_response.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp bedrock_evaluate_post_call_survey.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/


echo "All Lambda packages uploaded successfully to s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/"