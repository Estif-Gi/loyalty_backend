/**
 * Reusable helper functions for order workflow and validation.
 */

const WORKFLOW_DEFINITIONS = {
  placed: {
    key: "placed",
    systemState: "OPEN",
    required: true
  },
  served: {
    key: "served",
    systemState: "IN_PROGRESS",
    required: false
  },
  completed: {
    key: "completed",
    systemState: "COMPLETED",
    required: true
  }
};

/**
 * Returns all enabled steps in a workflow, sorted by their order.
 * @param {Array} workflow 
 * @returns {Array}
 */
const getEnabledWorkflowSteps = (workflow) => {
    if (!Array.isArray(workflow)) return [];
    return workflow.filter(step => step.enabled).sort((a, b) => a.order - b.order);
};

/**
 * Returns a workflow step by its unique key.
 * @param {Array} workflow 
 * @param {String} key 
 * @returns {Object|null}
 */
const getWorkflowStepByKey = (workflow, key) => {
    if (!Array.isArray(workflow)) return null;
    return workflow.find(step => step.key === key) || null;
};

/**
 * Returns the next enabled step in the workflow.
 * @param {Array} workflow 
 * @param {String} currentKey 
 * @returns {Object|null}
 */
const getNextWorkflowStep = (workflow, currentKey) => {
    const enabledSteps = getEnabledWorkflowSteps(workflow);
    const currentIndex = enabledSteps.findIndex(step => step.key === currentKey);
    if (currentIndex === -1 || currentIndex === enabledSteps.length - 1) {
        return null;
    }
    return enabledSteps[currentIndex + 1];
};

/**
 * Returns the previous enabled step in the workflow.
 * @param {Array} workflow 
 * @param {String} currentKey 
 * @returns {Object|null}
 */
const getPreviousWorkflowStep = (workflow, currentKey) => {
    const enabledSteps = getEnabledWorkflowSteps(workflow);
    const currentIndex = enabledSteps.findIndex(step => step.key === currentKey);
    if (currentIndex <= 0) {
        return null;
    }
    return enabledSteps[currentIndex - 1];
};

/**
 * Validates the workflow configuration.
 * @param {Array} workflow 
 * @returns {Object} { isValid: Boolean, error?: String, message?: String, details?: Object }
 */
const validateWorkflow = (workflow) => {
    if (!Array.isArray(workflow) || workflow.length === 0) {
        return {
            isValid: false,
            error: "INVALID_ORDER_WORKFLOW",
            message: "The workflow configuration cannot be empty."
        };
    }

    const keys = new Set();
    const orders = new Set();
    const allowedKeys = Object.keys(WORKFLOW_DEFINITIONS);
    const allowedSystemStates = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
    const allowedRoles = ['chef', 'waiter', 'cashier'];

    for (const step of workflow) {
        if (!step.key || !allowedKeys.includes(step.key)) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `The workflow step key '${step?.key}' is invalid.`,
                details: { 
                    reason: `Allowed keys: ${allowedKeys.join(', ')}`, 
                    step: step?.key 
                }
            };
        }

        if (keys.has(step.key)) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `Duplicate workflow step key '${step.key}' found.`,
                details: { 
                    reason: "Duplicate keys are not allowed.", 
                    step: step.key 
                }
            };
        }
        keys.add(step.key);

        // Validate that step.order is finite, positive, integer (Section 4)
        if (typeof step.order !== 'number' || !Number.isFinite(step.order) || !Number.isInteger(step.order) || step.order <= 0) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW_ORDER",
                message: `Step '${step.key}' must have a valid positive integer 'order' value.`,
                details: { 
                    step: step.key,
                    received: step.order
                }
            };
        }

        if (orders.has(step.order)) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `Duplicate workflow order position '${step.order}' found.`,
                details: { 
                    reason: "Duplicate order positions are not allowed.", 
                    order: step.order 
                }
            };
        }
        orders.add(step.order);

        if (!step.systemState || !allowedSystemStates.includes(step.systemState)) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `Step '${step.key}' has an unknown system state '${step.systemState}'.`,
                details: { 
                    reason: `Allowed system states: ${allowedSystemStates.join(', ')}`, 
                    step: step.key 
                }
            };
        }

        if (step.responsibleRole && !allowedRoles.includes(step.responsibleRole)) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `Step '${step.key}' has an invalid responsible role '${step.responsibleRole}'.`,
                details: { 
                    reason: `Allowed roles: ${allowedRoles.join(', ')}`, 
                    step: step.key 
                }
            };
        }

        if (step.visibleToRoles && (!Array.isArray(step.visibleToRoles) || step.visibleToRoles.some(r => !allowedRoles.includes(r)))) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `Step '${step.key}' has invalid visibleToRoles.`,
                details: { 
                    reason: `Roles must be subset of: ${allowedRoles.join(', ')}`, 
                    step: step.key 
                }
            };
        }

        if (step.actionRoles && (!Array.isArray(step.actionRoles) || step.actionRoles.some(r => !allowedRoles.includes(r)))) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `Step '${step.key}' has invalid actionRoles.`,
                details: { 
                    reason: `Roles must be subset of: ${allowedRoles.join(', ')}`, 
                    step: step.key 
                }
            };
        }
    }

    // Validate required steps exist and are enabled
    const requiredKeys = ['placed', 'completed'];
    for (const reqKey of requiredKeys) {
        const step = workflow.find(s => s.key === reqKey);
        if (!step) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `Required workflow step '${reqKey}' is missing.`,
                details: { 
                    reason: `Required step '${reqKey}' must be defined.`, 
                    step: reqKey 
                }
            };
        }
        if (step.enabled === false) {
            return {
                isValid: false,
                error: "INVALID_ORDER_WORKFLOW",
                message: `The workflow step '${reqKey}' is required and cannot be disabled.`,
                details: { 
                    reason: `Required workflow step '${reqKey}' cannot be disabled.`, 
                    step: reqKey 
                }
            };
        }
    }

    // Enforce PLACED as first enabled step and COMPLETED as last enabled step (Section 2 & 3)
    const enabledSteps = workflow.filter(step => step.enabled).sort((a, b) => a.order - b.order);
    if (enabledSteps.length === 0) {
        return {
            isValid: false,
            error: "INVALID_ORDER_WORKFLOW_BOUNDARY",
            message: "The workflow configuration cannot have zero enabled steps."
        };
    }

    const firstStep = enabledSteps[0];
    const lastStep = enabledSteps[enabledSteps.length - 1];

    if (firstStep.key !== 'placed' || lastStep.key !== 'completed') {
        return {
            isValid: false,
            error: "INVALID_ORDER_WORKFLOW_BOUNDARY",
            message: "The workflow must start with 'placed' and end with 'completed'.",
            details: {
                firstEnabledStep: firstStep.key,
                lastEnabledStep: lastStep.key,
                requiredFirstStep: "placed",
                requiredLastStep: "completed"
            }
        };
    }

    return { isValid: true };
};

/**
 * Resolves the required system permission based on the step being advanced and the next step in sequence.
 * @param {string} currentKey - The key of the step being advanced
 * @param {string} nextKey - The key of the next active step
 * @returns {string|null} The required permission string
 */
function getRequiredPermissionForTransition(currentKey, nextKey) {
  if (nextKey === 'served') return 'orders:serve';
  if (nextKey === 'completed') return 'orders:serve';
  return null;
}

/**
 * Checks if an employee role has the permission to advance a given workflow step.
 * @param {object} params
 * @param {string} params.employeeRole - e.g. 'chef', 'waiter', 'cashier'
 * @param {Array<string>} params.employeePermissions - e.g. ['orders:view', 'orders:prepare']
 * @param {object} params.workflowStep - The current workflow step object (containing actionRoles)
 * @param {string} params.nextStepKey - The key of the next enabled step in the workflow
 * @returns {boolean} True if allowed, false otherwise
 */
function canRoleAdvanceWorkflowStep({ employeeRole, employeePermissions, workflowStep, nextStepKey }) {
  if (!workflowStep) return false;
  
  // 1. Employee role must be listed in the workflow step's actionRoles
  const actionRoles = workflowStep.actionRoles || [];
  if (!actionRoles.includes(employeeRole)) {
    return false;
  }

  // 2. Employee must fundamentally possess the required system capability
  const requiredPermission = getRequiredPermissionForTransition(workflowStep.key, nextStepKey);
  if (requiredPermission && !employeePermissions.includes(requiredPermission)) {
    return false;
  }

  return true;
}

module.exports = {
    WORKFLOW_DEFINITIONS,
    getEnabledWorkflowSteps,
    getWorkflowStepByKey,
    getNextWorkflowStep,
    getPreviousWorkflowStep,
    validateWorkflow,
    canRoleAdvanceWorkflowStep
};
