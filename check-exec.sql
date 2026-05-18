SELECT we.id, we.status, we."currentStep", we."eventValue", we."startedAt", l.email
FROM "WorkflowExecution" we
JOIN "Lead" l ON we."leadId" = l.id
ORDER BY we."startedAt" DESC
LIMIT 10;
