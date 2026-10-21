var Task = require('../models/task');
var respond = require('../utils/respond');
var v = require('../utils/validate');
var query = require('../utils/query');
var refs = require('../utils/references');

// Check the request body and return { error } or { value } with only the fields we allow.
// Anything else the client sends (_id, dateCreated, ...) is ignored.
// assignedUserName is left as the client sent it; refs.checkAssignment fills it in.
function readTaskBody(body) {
    body = body || {};
    if (!v.isNonEmptyString(body.name)) return { error: 'A task needs a name.' };

    var deadline = v.toDate(body.deadline);
    if (!deadline) return { error: 'A task needs a valid deadline.' };

    var description = '';
    if (body.description !== undefined && body.description !== null) {
        if (typeof body.description !== 'string') return { error: 'description must be text.' };
        description = body.description;
    }

    var completed = false;
    if (body.completed !== undefined) {
        completed = v.toBoolean(body.completed);
        if (completed === null) return { error: 'completed must be true or false.' };
    }

    var assignedUser = '';
    if (body.assignedUser !== undefined && body.assignedUser !== null) {
        if (typeof body.assignedUser !== 'string') return { error: 'assignedUser must be a user id.' };
        if (body.assignedUser !== '' && !v.isId(body.assignedUser)) return { error: 'assignedUser is not a valid user id.' };
        assignedUser = body.assignedUser;
    }

    var assignedUserName;
    if (body.assignedUserName !== undefined && body.assignedUserName !== null) {
        if (typeof body.assignedUserName !== 'string') return { error: 'assignedUserName must be text.' };
        assignedUserName = body.assignedUserName;
    }

    return {
        value: {
            name: body.name.trim(),
            description: description,
            deadline: deadline,
            completed: completed,
            assignedUser: assignedUser,
            assignedUserName: assignedUserName
        }
    };
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        await query.list(Task, req, res, 100);
    });

    tasksRoute.post(async function (req, res) {
        var parsed = readTaskBody(req.body);
        if (parsed.error) return respond.badRequest(res, parsed.error);

        var assignment = await refs.checkAssignment(parsed.value);
        if (assignment.error) return respond.fail(res, assignment.error);

        var task = await Task.create(parsed.value);
        await refs.syncTaskUsers(task, assignment.user);
        respond.created(res, task);
    });

    taskRoute.get(async function (req, res) {
        await query.one(Task, req, res, 'Task not found.');
    });

    taskRoute.put(async function (req, res) {
        var task = v.isId(req.params.id) ? await Task.findById(req.params.id) : null;
        if (!task) return respond.notFound(res, 'Task not found.');

        var parsed = readTaskBody(req.body);
        if (parsed.error) return respond.badRequest(res, parsed.error);

        var assignment = await refs.checkAssignment(parsed.value);
        if (assignment.error) return respond.fail(res, assignment.error);

        task.set(parsed.value);
        await task.save();
        await refs.syncTaskUsers(task, assignment.user);
        respond.ok(res, task);
    });

    taskRoute.delete(async function (req, res) {
        var task = v.isId(req.params.id) ? await Task.findByIdAndDelete(req.params.id) : null;
        if (!task) return respond.notFound(res, 'Task not found.');
        await refs.removeTaskFromUsers(task._id);
        respond.noContent(res);
    });

    return router;
};
