# Variables de entorno
$env:GCP_PROJECT="essential-haiku-482815-u4"
$env:BQ_DATASET="infra_gestion"
$env:GOOGLE_CLIENT_ID="354063050046-fkp06ao8aauems1gcj4hlngljf56o3cj.apps.googleusercontent.com"
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\Users\pbonafe\OneDrive - Getronics\Documents\politica\Cooperativas\infraestructura\sistema_gestion_fastapi\infra-app\essential-haiku-482815-u4-adce533de2da.json"
Write-Host "GOOGLE_APPLICATION_CREDENTIALS=$env:GOOGLE_APPLICATION_CREDENTIALS"

# Activar virtualenv (IMPORTANTE)
.\.venv\Scripts\Activate.ps1

# Levantar API
uvicorn app.main:app --reload --port 8080
