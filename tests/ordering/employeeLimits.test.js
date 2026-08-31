const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');
const Employee = require('../../model/employee');

describe('Employee Limits and Deletion API', () => {
  let ownerToken, ownerUser;
  let restaurant;

  beforeEach(async () => {
    // Create Owner
    ownerUser = await User.create({
      name: 'Owner User',
      phone: '+251929999999',
      password: 'password123',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    // Create Restaurant on 'free' tier (limit: 2 staff)
    restaurant = await Restaurant.create({
      name: 'Test Restaurant',
      phone: '+251911223344',
      owner: ownerUser._id,
      billingStatus: 'free'
    });
  });

  test('should enforce total employee limits on creation and prevent deactivation bypass', async () => {
    // 1. Create first employee -> Success
    const res1 = await request(app)
      .post(`/api/restaurants/${restaurant._id}/employees`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Employee One',
        password: 'password123',
        role: 'waiter'
      });
    expect(res1.status).toBe(201);

    // 2. Create second employee -> Success
    const res2 = await request(app)
      .post(`/api/restaurants/${restaurant._id}/employees`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Employee Two',
        password: 'password123',
        role: 'chef'
      });
    expect(res2.status).toBe(201);

    // 3. Deactivate first employee -> Success
    const deactivateRes = await request(app)
      .patch(`/api/restaurants/${restaurant._id}/employees/${res1.body._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        isActive: false
      });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.isActive).toBe(false);

    // 4. Try to create third employee -> Fails (limit is 2 total accounts, regardless of activation status)
    const res3 = await request(app)
      .post(`/api/restaurants/${restaurant._id}/employees`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Employee Three',
        password: 'password123',
        role: 'cashier'
      });
    expect(res3.status).toBe(400);
    expect(res3.body.message).toContain('Staff account limit reached');
  });

  test('should enforce active employee limits on reactivation', async () => {
    // 1. Create first employee -> Success
    const emp1 = await Employee.create({
      name: 'Emp One',
      restaurant: restaurant._id,
      password: 'hashedpassword',
      role: 'waiter',
      isActive: true
    });

    // 2. Create second employee -> Success
    const emp2 = await Employee.create({
      name: 'Emp Two',
      restaurant: restaurant._id,
      password: 'hashedpassword',
      role: 'chef',
      isActive: true
    });

    // 3. Create an inactive employee directly in DB (to simulate a total limit increase, e.g. from upgrade/downgrade history)
    const emp3 = await Employee.create({
      name: 'Emp Three',
      restaurant: restaurant._id,
      password: 'hashedpassword',
      role: 'cashier',
      isActive: false
    });

    // 4. Try to reactivate Employee Three -> Fails because active employee limit (2) is already reached (emp1 and emp2 are active)
    const reactivateRes = await request(app)
      .patch(`/api/restaurants/${restaurant._id}/employees/${emp3._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        isActive: true
      });
    expect(reactivateRes.status).toBe(400);
    expect(reactivateRes.body.message).toContain('Staff account limit reached');
  });

  test('should allow deleting an employee to free up a slot', async () => {
    // 1. Create first employee -> Success
    const res1 = await request(app)
      .post(`/api/restaurants/${restaurant._id}/employees`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Employee One',
        password: 'password123',
        role: 'waiter'
      });
    expect(res1.status).toBe(201);

    // 2. Create second employee -> Success
    const res2 = await request(app)
      .post(`/api/restaurants/${restaurant._id}/employees`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Employee Two',
        password: 'password123',
        role: 'chef'
      });
    expect(res2.status).toBe(201);

    // 3. Try to create third employee -> Fails
    const res3 = await request(app)
      .post(`/api/restaurants/${restaurant._id}/employees`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Employee Three',
        password: 'password123',
        role: 'cashier'
      });
    expect(res3.status).toBe(400);

    // 4. Delete Employee One -> Success
    const deleteRes = await request(app)
      .delete(`/api/restaurants/${restaurant._id}/employees/${res1.body._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.message).toBe('Employee deleted successfully');

    // 5. Create Employee Three again -> Success (total is now 2/2)
    const res3Retry = await request(app)
      .post(`/api/restaurants/${restaurant._id}/employees`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Employee Three',
        password: 'password123',
        role: 'cashier'
      });
    expect(res3Retry.status).toBe(201);
  });
});
