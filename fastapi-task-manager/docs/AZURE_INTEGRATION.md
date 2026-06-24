# Azure Integration Guide

This document explains how to take the locally-running Task Manager API and
(1) persist its data in **Azure Table Storage** and (2) **host** it on Azure.
Everything here uses **placeholders** — fill them in once you have a
subscription. Nothing in this guide is required to run the app locally.

> Placeholders are written as `<LIKE_THIS>`. Replace them with your real values.

---

## Part 1 — Persist data in Azure Table Storage

Azure Table Storage is a cheap, simple NoSQL key/value store — a great first
integration. The code is already implemented in `app/storage.py`
(`AzureTableTaskStore`); you only need config + the SDK.

### 1.1 Install the SDK

Uncomment this line in `requirements.txt` and reinstall:

```text
azure-data-tables==12.5.0
```

```powershell
pip install -r requirements.txt
```

### 1.2 Create the storage account (Azure CLI)

```bash
# Login first
az login

# Variables — replace placeholders
RG="<RESOURCE_GROUP>"
LOCATION="<AZURE_REGION>"          # e.g. eastus
STORAGE="<STORAGE_ACCOUNT_NAME>"   # 3-24 lowercase letters/numbers, globally unique

az group create --name "$RG" --location "$LOCATION"

az storage account create \
  --name "$STORAGE" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS

# Get the connection string
az storage account show-connection-string \
  --name "$STORAGE" \
  --resource-group "$RG" \
  --query connectionString -o tsv
```

### 1.3 Configure the app

In your `.env` (local) **or** Azure App Settings (cloud):

```env
STORAGE_BACKEND=azure_table
AZURE_STORAGE_CONNECTION_STRING=<PASTE_CONNECTION_STRING>
AZURE_TABLE_NAME=tasks
```

Restart the app. It now reads/writes tasks in Azure Table Storage. The table is
created automatically on startup if it doesn't exist.

> ⚠️ **Security:** A connection string is a secret. Don't commit it. Prefer
> **Azure Key Vault** (Part 3) or, better, **Managed Identity** so there is no
> secret at all.

---

## Part 2 — Host the API on Azure

You write the same FastAPI app; you only choose *where* it runs. Two common
options:

### Option A — Azure App Service (simplest for a single web API)

```bash
RG="<RESOURCE_GROUP>"
PLAN="<APP_SERVICE_PLAN_NAME>"
APP="<WEBAPP_NAME>"               # becomes https://<WEBAPP_NAME>.azurewebsites.net

az appservice plan create \
  --name "$PLAN" --resource-group "$RG" --sku B1 --is-linux

az webapp create \
  --resource-group "$RG" --plan "$PLAN" --name "$APP" \
  --runtime "PYTHON:3.12"

# Tell App Service how to start uvicorn (the "startup command")
az webapp config set \
  --resource-group "$RG" --name "$APP" \
  --startup-file "python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

# Push configuration (App Settings == environment variables)
az webapp config appsettings set \
  --resource-group "$RG" --name "$APP" \
  --settings \
    STORAGE_BACKEND=azure_table \
    AZURE_TABLE_NAME=tasks \
    AZURE_STORAGE_CONNECTION_STRING="<PASTE_CONNECTION_STRING>" \
    CORS_ALLOWED_ORIGINS="https://<YOUR_FRONTEND_DOMAIN>"

# Deploy code (simplest: zip deploy from this folder)
az webapp up --name "$APP" --resource-group "$RG" --runtime "PYTHON:3.12"
```

Health check path for App Service: set it to `/health`.

### Option B — Azure Container Apps (containerized, scales to zero)

Build a container with this `Dockerfile` (create it in the project root):

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
RG="<RESOURCE_GROUP>"
ACR="<CONTAINER_REGISTRY_NAME>"
ENVNAME="<CONTAINER_APP_ENV>"
APP="<CONTAINER_APP_NAME>"

# Build & push the image to Azure Container Registry
az acr create --resource-group "$RG" --name "$ACR" --sku Basic
az acr build --registry "$ACR" --image task-manager-api:latest .

# Create the Container Apps environment and app
az containerapp env create --name "$ENVNAME" --resource-group "$RG" --location "<AZURE_REGION>"

az containerapp create \
  --name "$APP" --resource-group "$RG" --environment "$ENVNAME" \
  --image "$ACR.azurecr.io/task-manager-api:latest" \
  --target-port 8000 --ingress external \
  --registry-server "$ACR.azurecr.io" \
  --env-vars \
    STORAGE_BACKEND=azure_table \
    AZURE_TABLE_NAME=tasks \
    AZURE_STORAGE_CONNECTION_STRING="<PASTE_CONNECTION_STRING>"
```

---

## Part 3 — Secrets the right way (Key Vault + Managed Identity)

Instead of putting the connection string in App Settings, store it in Key Vault
and let the app's **Managed Identity** read it — no secret in code or config.

```bash
RG="<RESOURCE_GROUP>"
VAULT="<KEY_VAULT_NAME>"
APP="<WEBAPP_NAME>"

az keyvault create --name "$VAULT" --resource-group "$RG" --location "<AZURE_REGION>"

az keyvault secret set \
  --vault-name "$VAULT" \
  --name "StorageConnectionString" \
  --value "<PASTE_CONNECTION_STRING>"

# Give the web app a system-assigned identity
az webapp identity assign --resource-group "$RG" --name "$APP"

# Grant that identity read access to secrets
PRINCIPAL_ID=$(az webapp identity show --resource-group "$RG" --name "$APP" --query principalId -o tsv)
az keyvault set-policy --name "$VAULT" --object-id "$PRINCIPAL_ID" --secret-permissions get list

# Reference the secret from App Settings (App Service resolves it at runtime)
az webapp config appsettings set --resource-group "$RG" --name "$APP" --settings \
  AZURE_STORAGE_CONNECTION_STRING="@Microsoft.KeyVault(SecretUri=https://$VAULT.vault.azure.net/secrets/StorageConnectionString/)"
```

> Going further: with Managed Identity you can drop connection strings entirely
> and authenticate to Table Storage via `DefaultAzureCredential`. That's a great
> follow-up exercise for a future session.

---

## Part 4 — Production checklist (security & reliability)

App-level (your FastAPI code):
- [ ] Separate input/output schemas (done — see `app/schemas.py`)
- [ ] Restrict CORS to known origins, not `*` (done — `CORS_ALLOWED_ORIGINS`)
- [ ] Add authentication (OAuth2/JWT or API keys) before exposing publicly
- [ ] Add rate limiting (e.g. `slowapi`) to prevent abuse/brute force
- [ ] Keep dependencies patched (`fastapi`, `pydantic`, `python-multipart`)
- [ ] Don't leak stack traces — keep debug off in production

Azure infra:
- [ ] Enforce HTTPS only
- [ ] Store secrets in Key Vault / use Managed Identity
- [ ] Configure autoscale (App Service plan or Container Apps scale rules)
- [ ] Put Azure API Management or Front Door (with WAF) in front for gateway-
      level auth, throttling, and DDoS protection
- [ ] Enable Application Insights for logging/monitoring
- [ ] Set the health probe path to `/health`

---

## Placeholder reference

| Placeholder | Meaning |
|-------------|---------|
| `<RESOURCE_GROUP>` | Azure resource group name |
| `<AZURE_REGION>` | e.g. `eastus`, `centralindia` |
| `<STORAGE_ACCOUNT_NAME>` | Globally-unique storage account name |
| `<PASTE_CONNECTION_STRING>` | Storage account connection string |
| `<APP_SERVICE_PLAN_NAME>` / `<WEBAPP_NAME>` | App Service resources |
| `<CONTAINER_REGISTRY_NAME>` / `<CONTAINER_APP_ENV>` / `<CONTAINER_APP_NAME>` | Container Apps resources |
| `<KEY_VAULT_NAME>` | Key Vault name |
| `<YOUR_FRONTEND_DOMAIN>` | Origin allowed by CORS |
