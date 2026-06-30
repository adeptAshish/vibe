# Azure OpenAI Integration

Defaults to offline MockLLM. To use real Structured Outputs + function calling
(placeholders = `<...>`):

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

Notes:
- **Structured Outputs** require a model/api-version that supports
  `response_format: json_schema` with `strict: true` (e.g. recent gpt-4o family).
- **Function calling**: we advertise tool specs via `ToolRegistry.specs()` (OpenAI
  function format) and pass them as `tools=` with `tool_choice="auto"`.
- Prod hardening: keyless auth via `DefaultAzureCredential`, APIM AI Gateway for
  rate-limit/caching, secure the endpoint with Private Endpoint + Private DNS,
  log tool calls + token usage to Application Insights.
