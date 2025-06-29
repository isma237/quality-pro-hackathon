#!/bin/bash

# Vérifier que la variable LAMBDA_ARTIFACTS_BUCKET est définie
if [ -z "$LAMBDA_ARTIFACTS_BUCKET" ]; then
    echo "❌ Erreur: La variable LAMBDA_ARTIFACTS_BUCKET n'est pas définie"
    echo "Usage: LAMBDA_ARTIFACTS_BUCKET=your-bucket-name ./publish_lamba.sh"
    exit 1
fi

echo "📦 Publishing Lambda functions to bucket: $LAMBDA_ARTIFACTS_BUCKET"

# Nettoyer les anciens fichiers zip
rm -f *.zip

# Fonction pour zipper les fonctions Node.js avec installation des dépendances
zip_nodejs_function() {
    local function_name=$1
    echo "🔧 Processing Node.js function: $function_name"
    
    cd $function_name
    
    # Vérifier si package.json existe
    if [ ! -f "package.json" ]; then
        echo "❌ Erreur: package.json non trouvé dans $function_name"
        cd ..
        return 1
    fi
    
    # Installer les dépendances
    echo "📦 Installing dependencies for $function_name..."
    npm install --production
    
    # Créer le zip avec les node_modules
    zip -r ../${function_name}.zip . -x "*.git*" "*.DS_Store*"
    
    cd ..
    echo "✅ $function_name zipped successfully"
}

# Fonction pour zipper les fonctions Python (pas d'installation nécessaire)
zip_python_function() {
    local function_name=$1
    echo "🐍 Processing Python function: $function_name"
    
    cd $function_name
    zip -r ../${function_name}.zip . -x "*.git*" "*.DS_Store*" "*__pycache__*" "*.pyc"
    cd ..
    echo "✅ $function_name zipped successfully"
}

# Traiter les fonctions Node.js (nécessitent npm install)
echo "🟢 Processing Node.js functions..."
zip_nodejs_function "transcript"
zip_nodejs_function "get_transcript"
zip_nodejs_function "stepfunction_trigger"
zip_nodejs_function "wait_for_transcribe"
zip_nodejs_function "comprehend"
zip_nodejs_function "store_response"

# Traiter les fonctions Python (pas d'installation nécessaire)
echo "🟡 Processing Python functions..."
zip_python_function "bedrock_evaluate"
zip_python_function "bedrock_evaluate_post_call_survey"

echo "📤 Uploading Lambda packages to S3..."

# Upload vers S3
aws s3 cp transcript.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp get_transcript.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp stepfunction_trigger.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp wait_for_transcribe.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp comprehend.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp bedrock_evaluate.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp store_response.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/
aws s3 cp bedrock_evaluate_post_call_survey.zip s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/

echo "🎉 All Lambda packages uploaded successfully to s3://$LAMBDA_ARTIFACTS_BUCKET/lambdas/"

# Nettoyer les fichiers zip locaux (optionnel)
echo "🧹 Cleaning up local zip files..."
rm -f *.zip

echo "✨ Deployment preparation completed!"