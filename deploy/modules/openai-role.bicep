// ---------------------------------------------------------------------------
// Module: Azure OpenAI / AI Services role assignment (keyless AI chat)
// ---------------------------------------------------------------------------
// Deployed at the resource group of the target Cognitive Services / AI Services
// account (may be in another subscription) via the parent template. Grants the
// managed identity a data-plane role so az-scout can call Azure OpenAI with
// Microsoft Entra ID tokens instead of an API key.

targetScope = 'resourceGroup'

@description('Name of the existing Cognitive Services / AI Services account.')
param accountName string

@description('Principal ID of the managed identity.')
param principalId string

@description('Role definition ID to assign (Cognitive Services OpenAI User by default).')
param roleDefinitionId string = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: accountName
}

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, principalId, roleDefinitionId)
  scope: account
  properties: {
    principalId: principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalType: 'ServicePrincipal'
  }
}
