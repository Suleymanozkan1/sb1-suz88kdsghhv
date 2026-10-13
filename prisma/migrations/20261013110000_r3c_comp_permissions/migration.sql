-- Round 3 (Ödenmez ve İkram): the new comp permissions for the existing roles, as the role templates grant them.
UPDATE "Role" SET permissions = array_append(permissions, 'comp:view') WHERE key IN ('admin', 'cost_controller', 'fb_manager', 'accounting_manager', 'viewer') AND NOT ('comp:view' = ANY(permissions));
UPDATE "Role" SET permissions = array_append(permissions, 'comp:manage') WHERE key IN ('admin', 'cost_controller', 'fb_manager') AND NOT ('comp:manage' = ANY(permissions));
