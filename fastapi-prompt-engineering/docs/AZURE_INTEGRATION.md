# Azure OpenAI Integration

Defaults to offline MockLLM. To use a real model (placeholders = `<...>`):

```bash
az cognitiveservices account create -n <AOAI_NAME> -g <RG> -l <REGION> --kind OpenAI --sku S0
az cognitiveservices account deployment create -n <AOAI_NAME> -g <RG> \
  --deployment-name <DEPLOYMENT> --model-name gpt-4o-mini --model-version <VER> \
  --model-format OpenAI --sku-capacity 10 --sku-name Standard
```

Install SDK (uncomment `openai` in requirements.txt), then set:
```env
LLM_PROVIDER=azure_openai
AZURE_OPENAI_ENDPOINT=https://<AOAI_NAME>.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=<DEPLOYMENT>
AZURE_OPENAI_API_KEY=<KEY>   # prefer Managed Identity / Key Vault in prod
```

Production notes:
- **Prompt management:** version prompt files in git; consider Azure AI Foundry
  prompt flow / a prompt catalog for larger teams. Roll out via
  `DEFAULT_PROMPT_VERSION` like a feature flag.
- **Injection defense in depth:** pair the app-level separation here with
  **Azure AI Content Safety** (Prompt Shields) to detect jailbreak/injection at
  the platform layer.
- **Observability:** log `injection_suspected` + prompt version to Application
  Insights to track attack attempts and correlate quality by prompt version.
- Secure the endpoint with Private Endpoint + Private DNS; keyless auth via
  `DefaultAzureCredential`.
