const { getNextWorkflowStep, canRoleAdvanceWorkflowStep } = require('../utils/workflow');
const { ORDER_ERROR_CODES } = require('../constants/orders');

/**
 * Validates and resolves the next step advancement in the order's workflow snapshot.
 * Reuses the permissions checker to enforce system capability boundaries.
 * 
 * @param {object} order - Mongoose order document containing workflow steps
 * @param {object} employee - Employee object containing role and permissions
 * @returns {object} Transition result: { canAdvance: boolean, nextStep?: object, error?: string, message?: string }
 */
function resolveNextTransition(order, employee) {
  const steps = order.workflow.steps;
  const currentStepKey = order.currentStepKey;

  const nextStep = getNextWorkflowStep(steps, currentStepKey);
  if (!nextStep) {
    return {
      canAdvance: false,
      error: ORDER_ERROR_CODES.ORDER_NO_NEXT_WORKFLOW_STEP,
      message: 'The order is already in its completed or terminal state.'
    };
  }

  // Find the configuration step being advanced
  const currentStepConfig = steps.find((s) => s.key === currentStepKey);
  if (!currentStepConfig) {
    return {
      canAdvance: false,
      error: ORDER_ERROR_CODES.ORDER_WORKFLOW_PERMISSION_DENIED,
      message: 'Current workflow step configuration could not be resolved.'
    };
  }

  const isAllowed = canRoleAdvanceWorkflowStep({
    employeeRole: employee.role,
    employeePermissions: employee.permissions,
    workflowStep: currentStepConfig,
    nextStepKey: nextStep.key
  });

  if (!isAllowed) {
    return {
      canAdvance: false,
      error: ORDER_ERROR_CODES.ORDER_WORKFLOW_PERMISSION_DENIED,
      message: `The employee role '${employee.role}' lacks permission to transition order from '${currentStepKey}' to '${nextStep.key}'.`
    };
  }

  return {
    canAdvance: true,
    nextStep
  };
}

module.exports = {
  resolveNextTransition
};
