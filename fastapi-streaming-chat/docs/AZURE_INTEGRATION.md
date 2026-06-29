# Azure OpenAI Integration

Defaults to offline MockLLM. To use a real model (placeholders = `<...>`):

```bash
az cognitiveservices account create -n <AOAI_NAME> -g <RG> -l <REGION> --kind OpenAI --sku S0
az cognitiveservices account deployment create -n <AOAI_NAME> -g <RG> \
  --deployment-name <DEPLOYMENT> --model-name gpt-4o-mini --model-version <VER> \
  --model-format OpenAI --sku-capacity 10 --sku-name Standard
```
Install SDK (uncomment `openai` in requirements.txt) then set:
```env
LLM_PROVIDER=azure_openai
AZURE_OPENAI_ENDPOINT=https://<AOAI_NAME>.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=<DEPLOYMENT>
AZURE_OPENAI_API_KEY=<KEY>   # prefer Managed Identity/Key Vault in prod
```
Prod: keyless via `DefaultAzureCredential`, APIM gateway for rate-limit/caching,
secure with PEP + Private DNS, enforce HTTPS, log tokens/cost to App Insights.
