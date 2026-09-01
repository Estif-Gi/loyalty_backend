const { validateWorkflow, getNextWorkflowStep, getPreviousWorkflowStep, canRoleAdvanceWorkflowStep } = require('../../utils/workflow');

describe('Workflow Validation Invariants', () => {
  let baseWorkflow;

  beforeEach(() => {
    baseWorkflow = [
      { key: 'placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['waiter'], visibleToRoles: ['chef', 'waiter', 'cashier'], responsibleRole: 'waiter' },
      { key: 'served', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 2, actionRoles: ['waiter'], visibleToRoles: ['chef', 'waiter', 'cashier'], responsibleRole: 'waiter' },
      { key: 'completed', systemState: 'COMPLETED', enabled: true, required: true, order: 3, actionRoles: [], visibleToRoles: ['chef', 'waiter', 'cashier'], responsibleRole: null }
    ];
  });

  test('Valid canonical 3-step workflow passes validation', () => {
    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(true);
  });

  test('Reject workflow if placed is not the first enabled step', () => {
    baseWorkflow[0].order = 2; // placed
    baseWorkflow[1].order = 1; // served
    
    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_BOUNDARY');
    expect(res.details.firstEnabledStep).toBe('served');
  });

  test('Reject workflow if completed is not the last enabled step', () => {
    baseWorkflow[2].order = 2; // completed
    baseWorkflow[1].order = 3; // served

    const res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW_BOUNDARY');
    expect(res.details.lastEnabledStep).toBe('served');
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
    baseWorkflow[2].enabled = false;
    res = validateWorkflow(baseWorkflow);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('INVALID_ORDER_WORKFLOW');
  });

  test('Reject obsolete / unknown keys (preparing, ready, serving, unknown)', () => {
    const obsoleteKeys = ['preparing', 'ready', 'serving', 'unknown'];
    for (const key of obsoleteKeys) {
      const customFlow = [
        ...baseWorkflow,
        { key, systemState: 'IN_PROGRESS', enabled: true, order: 4 }
      ];
      const res = validateWorkflow(customFlow);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('INVALID_ORDER_WORKFLOW');
    }
  });
});

describe('Workflow Step Traversal with Skips', () => {
  let workflow;

  beforeEach(() => {
    workflow = [
      { key: 'placed', enabled: true, order: 1 },
      { key: 'served', enabled: false, order: 2 },
      { key: 'completed', enabled: true, order: 3 }
    ];
  });

  test('getNextWorkflowStep skips served if disabled', () => {
    const nextStep = getNextWorkflowStep(workflow, 'placed');
    expect(nextStep).not.toBeNull();
    expect(nextStep.key).toBe('completed');
  });

  test('getPreviousWorkflowStep skips served if disabled', () => {
    const prevStep = getPreviousWorkflowStep(workflow, 'completed');
    expect(prevStep).not.toBeNull();
    expect(prevStep.key).toBe('placed');
  });

  test('Standard traversal placed -> served -> completed', () => {
    const activeWorkflow = [
      { key: 'placed', enabled: true, order: 1 },
      { key: 'served', enabled: true, order: 2 },
      { key: 'completed', enabled: true, order: 3 }
    ];

    const step1 = getNextWorkflowStep(activeWorkflow, 'placed');
    expect(step1.key).toBe('served');

    const step2 = getNextWorkflowStep(activeWorkflow, 'served');
    expect(step2.key).toBe('completed');

    const step3 = getNextWorkflowStep(activeWorkflow, 'completed');
    expect(step3).toBeNull();
  });
});

describe('Workflow Permission Handover Semantics', () => {
  const chefPermissions = ['orders:view', 'orders:prepare', 'orders:ready'];
  const waiterPermissions = ['orders:view', 'orders:serve', 'orders:payment'];
  const cashierPermissions = ['orders:view', 'orders:payment'];

  test('Waiter listed in actionRoles & has orders:serve -> allowed for placed -> served', () => {
    const step = { key: 'placed', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'waiter',
      employeePermissions: waiterPermissions,
      workflowStep: step,
      nextStepKey: 'served'
    });
    expect(allowed).toBe(true);
  });

  test('Waiter listed in actionRoles & has orders:serve -> allowed for served -> completed', () => {
    const step = { key: 'served', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'waiter',
      employeePermissions: waiterPermissions,
      workflowStep: step,
      nextStepKey: 'completed'
    });
    expect(allowed).toBe(true);
  });

  test('Chef attempted advance placed -> served is denied (Chef not in actionRoles & lacks orders:serve)', () => {
    const step = { key: 'placed', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'chef',
      employeePermissions: chefPermissions,
      workflowStep: step,
      nextStepKey: 'served'
    });
    expect(allowed).toBe(false);
  });

  test('Chef attempted advance served -> completed is denied', () => {
    const step = { key: 'served', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'chef',
      employeePermissions: chefPermissions,
      workflowStep: step,
      nextStepKey: 'completed'
    });
    expect(allowed).toBe(false);
  });

  test('Waiter lacking orders:serve capability is denied', () => {
    const step = { key: 'placed', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'waiter',
      employeePermissions: ['orders:view'], // lacks 'orders:serve'
      workflowStep: step,
      nextStepKey: 'served'
    });
    expect(allowed).toBe(false);
  });

  test('Cashier attempted advance is denied', () => {
    const step = { key: 'placed', actionRoles: ['waiter'] };
    const allowed = canRoleAdvanceWorkflowStep({
      employeeRole: 'cashier',
      employeePermissions: cashierPermissions,
      workflowStep: step,
      nextStepKey: 'served'
    });
    expect(allowed).toBe(false);
  });
});
