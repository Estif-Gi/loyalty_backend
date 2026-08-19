const { validateWorkflow, getNextWorkflowStep, getPreviousWorkflowStep, canRoleAdvanceWorkflowStep } = require('../../utils/workflow');

describe('Workflow Validation Invariants', () => {
  let baseWorkflow;

  beforeEach(() => {
    baseWorkflow = [
      { key: 'placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['chef'] },
      { key: 'preparing', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 2, actionRoles: ['chef'] },
      { key: 'ready', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 3, actionRoles: ['waiter'] },
      { key: 'serving', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 4, actionRoles: ['waiter'] },
      { key: 'completed', systemState: 'COMPLETED', enabled: true, required: true, order: 5, actionRoles: ['cashier'] }
    ];
  });

  test('Valid workflow passes validation', () => {
    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(true);
  });

  test('Reject workflow if placed is not the first enabled step', () => {
    // Set orders so preparing (1) is before placed (2) with no duplicates
    baseWorkflow[0].order = 2; // placed
    baseWorkflow[1].order = 1; // preparing
    
    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_BOUNDARY');
    expect(res.details.firstEnabledStep).toBe('preparing');
  });

  test('Reject workflow if completed is not the last enabled step', () => {
    // Set orders so completed (4) is before serving (5) with no duplicates
    baseWorkflow[4].order = 4; // completed
    baseWorkflow[3].order = 5; // serving

    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_BOUNDARY');
    expect(res.details.lastEnabledStep).toBe('serving');
  });

  test('Reject non-integer step.order values', () => {
    // Double / float
    baseWorkflow[1].order = 2.5;
    let res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_ORDER');

    // NaN
    baseWorkflow[1].order = NaN;
    res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_ORDER');

    // Infinity
    baseWorkflow[1].order = Infinity;
    res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_ORDER');

    // Negative / Zero
    baseWorkflow[1].order = -1;
    res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_ORDER');

    baseWorkflow[1].order = 0;
    res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_ORDER');
  });

  test('Reject duplicate order values', () => {
    baseWorkflow[1].order = 1; // duplicate of placed
    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW');
    expect(res.message).toContain('Duplicate workflow order position');
  });

  test('Reject disabling required steps (placed or completed)', () => {
    baseWorkflow[0].enabled = false;
    let res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW');

    baseWorkflow[0].enabled = true;
    baseWorkflow[4].enabled = false;
    res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW');
  });

  test('Reject unknown key', () => {
    baseWorkflow.push({ key: 'unknown', systemState: 'IN_PROGRESS', enabled: true, order: 6 });
    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW');
  });
});

describe('Workflow Step Traversal with Skips', () => {
  let workflow;

  beforeEach(() => {
    // ready is disabled
    workflow = [
      { key: 'placed', enabled: true, order: 1 },
      { key: 'preparing', enabled: true, order: 2 },
      { key: 'ready', enabled: false, order: 3 },
      { key: 'serving', enabled: true, order: 4 },
      { key: 'completed', enabled: true, order: 5 }
    ];
  });

  test('getNextWorkflowStep skips ready if disabled', () => {
    const nextStep = getNextWorkflowStep(workflow, 'preparing');
    expect(nextStep).not.toBeNull();
    expect(nextStep.key).toBe('serving');
  });

  test('getPreviousWorkflowStep skips ready if disabled', () => {
    const prevStep = getPreviousWorkflowStep(workflow, 'serving');
    expect(prevStep).not.toBeNull();
    expect(prevStep.key).toBe('preparing');
  });
});

describe('Workflow Permission Handover Semantics', () => {
  const chefPermissions = ['orders:view', 'orders:prepare', 'orders:ready'];
  const waiterPermissions = ['orders:view', 'orders:claim', 'orders:serve'];
  const cashierPermissions = ['orders:view', 'orders:payment'];

  test('Chef listed in actionRoles & has capability -> allowed', () => {
    const step = { key: 'placed', actionRoles: ['chef'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'chef',
      employeePermissions: chefPermissions,
      workflowStep: step,
      nextStepKey: 'preparing'
    });
    expect(allowed).toBe(true);
  });

  test('Chef listed in actionRoles but lacks capability -> denied', () => {
    const step = { key: 'serving', actionRoles: ['chef'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'chef',
      employeePermissions: chefPermissions,
      workflowStep: step,
      nextStepKey: 'completed'
    });
    expect(allowed).toBe(false); // Chef lacks "orders:payment"
  });

  test('Chef has capability but not listed in actionRoles -> denied', () => {
    const step = { key: 'placed', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'chef',
      employeePermissions: chefPermissions,
      workflowStep: step,
      nextStepKey: 'preparing'
    });
    expect(allowed).toBe(false);
  });

  test('Waiter listed in actionRoles but lacks capability -> denied', () => {
    const step = { key: 'preparing', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'waiter',
      employeePermissions: waiterPermissions,
      workflowStep: step,
      nextStepKey: 'ready' // Transitions to ready -> requires 'orders:ready'
    });
    expect(allowed).toBe(false); // Waiter lacks 'orders:ready'
  });

  test('Ready disabled: Waiter claims from preparing -> allowed', () => {
    const step = { key: 'preparing', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'waiter',
      employeePermissions: waiterPermissions,
      workflowStep: step,
      nextStepKey: 'serving' // Direct transition to serving -> requires 'orders:serve'
    });
    expect(allowed).toBe(true); // Waiter possesses 'orders:serve'
  });
});
