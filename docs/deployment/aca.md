---
description: "Deploy az-scout to Azure Container Apps (ACA), with deployment assets and EasyAuth guidance maintained in docs/."
---

# Azure Container Apps (ACA) Deployment

This page centralizes ACA deployment from the `deploy/` folder and keeps the original assets as the source of truth.

## Deployment assets

- Main Bicep template: [deploy/main.bicep](https://github.com/az-scout/az-scout/blob/main/deploy/main.bicep)
- Example parameters: [deploy/main.example.bicepparam](https://github.com/az-scout/az-scout/blob/main/deploy/main.example.bicepparam)
- Generated ARM JSON: [deploy/main.json](https://github.com/az-scout/az-scout/blob/main/deploy/main.json)
- Subscription reader module: [deploy/modules/subscription-reader.bicep](https://github.com/az-scout/az-scout/blob/main/deploy/modules/subscription-reader.bicep)
- Spot score module: [deploy/modules/subscription-spot-score.bicep](https://github.com/az-scout/az-scout/blob/main/deploy/modules/subscription-spot-score.bicep)
- Azure OpenAI role module: [deploy/modules/openai-role.bicep](https://github.com/az-scout/az-scout/blob/main/deploy/modules/openai-role.bicep)
- Portal UI definition: [deploy/createUiDefinition.json](https://github.com/az-scout/az-scout/blob/main/deploy/createUiDefinition.json)
- EasyAuth automation script: [deploy/setup-easyauth.sh](https://github.com/az-scout/az-scout/blob/main/deploy/setup-easyauth.sh)

## AI chat (keyless)

The container app runs with a user-assigned managed identity (`AZURE_CLIENT_ID` is set by
the template), so the AI chat can authenticate to Azure OpenAI / Foundry **without an API
key** — required when the AI resource enforces `disableLocalAuth = true`.

The template wires this up through optional parameters (also available in the portal's
**AI Chat** step):

| Parameter | Effect |
|---|---|
| `openAiEndpoint` | Sets `AZURE_OPENAI_ENDPOINT` (e.g. `https://<account>.services.ai.azure.com`) |
| `openAiDeployment` | Sets `AZURE_OPENAI_DEPLOYMENT` (e.g. `gpt-4o`) |
| `openAiResourceId` *(optional)* | Grants the managed identity **Cognitive Services OpenAI User** on that AI Services account (it can live in another subscription / resource group) |
| `openAiRoleDefinitionId` *(optional)* | Role to grant instead (e.g. the **Azure AI User** role ID for Foundry) |

The env vars are only set when both `openAiEndpoint` and `openAiDeployment` are provided.
No `AZURE_OPENAI_API_KEY` is ever stored.

```bash
az deployment group create \
  -g <resource-group> \
  -f deploy/main.bicep \
  -p readerSubscriptionIds='["<sub-id>"]' \
  -p openAiEndpoint=https://<account>.services.ai.azure.com \
  -p openAiDeployment=<deployment> \
  -p openAiResourceId=<ai-services-account-resource-id>
```

The deploying principal needs permission to create role assignments on the AI Services
account (e.g. **Owner** or **User Access Administrator**). Without `openAiResourceId`, grant
the role yourself — to the identity whose principal ID is in the `identityPrincipalId`
output:

```bash
az role assignment create \
  --assignee <identity-principal-id> \
  --role "Cognitive Services OpenAI User" \
  --scope <ai-services-account-resource-id>
```

A `401`/`403` from Azure OpenAI is reported in the chat with a hint about the missing role
or a wrong `AZURE_CLIENT_ID`.

## EasyAuth guide

See the [EasyAuth guide](../deployment/easyauth.md) for a complete walkthrough of Entra ID authentication configuration.
