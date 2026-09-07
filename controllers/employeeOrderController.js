const mongoose = require('mongoose');
const Order = require('../model/order');
const { resolveNextTransition } = require('../services/orderWorkflowService');
const { ORDER_ERROR_CODES, SYSTEM_STATES } = require('../constants/orders');

const Restaurant = require('../model/restaurant');

const { serializeOrderForEmployee } = require('../serializers/orderSerializer');
const { emitOrderUpdated, emitOrderCancelled } = require('../services/orderRealtimeService');

exports.getEmployeeOrders = async (req, res) => {
  try {
    const { status } = req.query; // 'active' or 'history'
    const query = {};

    if (req.user.role === 'owner') {
      const filterId = req.query.restaurantId;
      if (filterId) {
        // Enforce valid ObjectId
        if (!mongoose.isValidObjectId(filterId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid restaurant ID format.'
          });
        }
        const ownedRestaurant = await Restaurant.findOne({ _id: filterId, owner: req.user.id });
        if (!ownedRestaurant) {
          return res.status(403).json({
            success: false,
            error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
            message: 'Not authorized. You do not own this restaurant.'
          });
        }
        query.restaurant = filterId;
      } else {
        const ownedRestaurants = await Restaurant.find({ owner: req.user.id });
        if (!ownedRestaurants || ownedRestaurants.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'No restaurants found for this owner.'
          });
        }
        query.restaurant = { $in: ownedRestaurants.map(r => r._id) };
      }
    } else if (req.user.role === 'employee' && req.employee) {
      query.restaurant = req.employee.restaurantId;
    } else {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    if (status === 'active') {
      query.systemState = { $in: [SYSTEM_STATES.OPEN, SYSTEM_STATES.IN_PROGRESS] };
    } else if (status === 'history') {
      query.systemState = { $in: [SYSTEM_STATES.COMPLETED, SYSTEM_STATES.CANCELLED] };
    }

    // Sort active oldest-first, history newest-first
    const sortOrder = status === 'history' ? { createdAt: -1 } : { createdAt: 1 };

    const orders = await Order.find(query)
      .populate('table', 'name code')
      .populate('customer', 'name phone')
      .populate('service.waiter', 'name role')
      .sort(sortOrder);

    // Filter queue based on step role visibility and waiter table assignment
    const visibleOrders = orders.filter((order) => {
      // Owners bypass all visibility filters
      if (req.user.role === 'owner') return true;

      const step = order.workflow.steps.find((s) => s.key === order.currentStepKey);
      if (!step) return false;
      if (!step.visibleToRoles || step.visibleToRoles.length === 0) return true;
      if (!step.visibleToRoles.includes(req.employee.role)) return false;

      // Waiters are restricted to their assigned orders (Section 24)
      if (req.employee.role === 'waiter') {
        if (!order.service || !order.service.waiter) return false;
        const waiterId = order.service.waiter._id 
          ? order.service.waiter._id.toString() 
          : order.service.waiter.toString();
        return waiterId === req.employee.id;
      }

      return true;
    });

    res.json({
      success: true,
      data: {
        orders: visibleOrders.map((o) => serializeOrderForEmployee(o, req.employee))
      }
    });
  } catch (error) {
    console.error('🔥 Error in getEmployeeOrders:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error fetching queue.'
    });
  }
};

exports.advanceOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { expectedStep } = req.body;

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_NOT_FOUND,
        message: 'Invalid order ID format.'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_NOT_FOUND,
        message: 'Order not found.'
      });
    }

    // Verify employee restaurant isolation
    if (order.restaurant.toString() !== req.employee.restaurantId) {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Not authorized. This order belongs to another restaurant.'
      });
    }

    // Verify dynamic workflow transition permission (ROLE_PERMISSIONS + actionRoles)
    const transition = resolveNextTransition(order, req.employee);
    if (!transition.canAdvance) {
      return res.status(403).json({
        success: false,
        error: transition.error,
        message: transition.message
      });
    }

    // Verify waiter assignment restriction (Section 28)
    if (req.employee.role === 'waiter' && order.service && order.service.waiter) {
      const waiterId = order.service.waiter._id 
        ? order.service.waiter._id.toString() 
        : order.service.waiter.toString();
      if (waiterId !== req.employee.id) {
        return res.status(403).json({
          success: false,
          error: 'ORDER_ASSIGNED_TO_ANOTHER_WAITER',
          message: 'This order is assigned to another waiter.'
        });
      }
    }

    const { nextStep } = transition;

    // Verify concurrency expected step (Section 37)
    if (order.currentStepKey !== expectedStep) {
      return res.status(409).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_STATE_CHANGED,
        message: 'This order was already updated by another employee. Please refresh.'
      });
    }

    const previousStepKey = order.currentStepKey;

    // Resolve updates & responsibility tracking (Section 38)
    const updateSet = {
      currentStepKey: nextStep.key,
      systemState: nextStep.systemState
    };

    if (nextStep.key === 'served') {
      updateSet['service.servedAt'] = new Date();
    }

    const timelineAction = nextStep.key === 'served'
      ? 'order_served'
      : (nextStep.key === 'completed' ? 'order_completed' : 'workflow_advanced');

    const timelineNote = nextStep.key === 'served'
      ? 'Order marked as served.'
      : (nextStep.key === 'completed' ? 'Order completed.' : `Step advanced to ${nextStep.key} by ${req.employee.role}`);

    // Atomically transition status
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        currentStepKey: expectedStep
      },
      {
        $set: updateSet,
        $push: {
          timeline: {
            stepKey: nextStep.key,
            systemState: nextStep.systemState,
            actorType: 'employee',
            actorId: req.employee.id,
            actorRole: req.employee.role,
            action: timelineAction,
            note: timelineNote
          }
        }
      },
      { new: true }
    ).populate('table', 'name code');

    if (!updatedOrder) {
      return res.status(409).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_STATE_CHANGED,
        message: 'This order was already updated by another employee. Please refresh.'
      });
    }

    // Emit realtime update after committed MongoDB write
    emitOrderUpdated(updatedOrder, { previousStepKey });

    res.json({
      success: true,
      data: {
        order: serializeOrderForEmployee(updatedOrder, req.employee)
      }
    });
  } catch (error) {
    console.error('🔥 Error in advanceOrder:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error advancing workflow step.'
    });
  }
};

exports.claimOrder = async (req, res) => {
  return res.status(410).json({
    success: false,
    error: 'ORDER_CLAIM_DEPRECATED',
    message: 'Waiter claiming is deprecated. Orders are automatically assigned based on table configuration.'
  });
};

exports.cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_NOT_FOUND,
        message: 'Order not found.'
      });
    }

    // Verify employee restaurant isolation
    if (order.restaurant.toString() !== req.employee.restaurantId) {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Not authorized.'
      });
    }

    if (order.systemState === SYSTEM_STATES.COMPLETED) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_CANCELLATION_NOT_ALLOWED,
        message: 'Cannot cancel an already completed order.'
      });
    }

    order.systemState = SYSTEM_STATES.CANCELLED;
    order.cancellation = {
      reason: reason || 'Cancelled by staff override',
      cancelledBy: req.employee.id,
      actorType: 'employee',
      cancelledAt: new Date()
    };
    order.timeline.push({
      stepKey: order.currentStepKey,
      systemState: SYSTEM_STATES.CANCELLED,
      actorType: 'employee',
      actorId: req.employee.id,
      actorRole: req.employee.role,
      action: 'order_cancelled',
      note: reason || 'Cancelled by staff override'
    });

    await order.save();

    emitOrderCancelled(order, { reason: order.cancellation?.reason });

    res.json({
      success: true,
      message: 'Order successfully cancelled.',
      data: {
        order: serializeOrderForEmployee(order)
      }
    });
  } catch (error) {
    console.error('🔥 Error in cancelOrder:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error cancelling order.'
    });
  }
};
