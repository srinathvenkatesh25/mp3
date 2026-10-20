// Keeps users and tasks in agreement (the "two-way references").
//
// The rule we maintain:
//   - a task that is assigned to a user and NOT completed is in that user's pendingTasks
//   - every id in a user's pendingTasks is a pending task whose assignedUser/assignedUserName are that user
//   - an unassigned task has assignedUser "" and assignedUserName "unassigned"
//
// Every function here is either a CHECK (reads only, returns { error }) or a SYNC (writes).
// Routes run all the checks first, so a failed request never changes anything.
var User = require('../models/user');
var Task = require('../models/task');

var UNASSIGNED = { assignedUser: '', assignedUserName: 'unassigned' };

// ---------- checks (no writes) ----------

// For a user's new pendingTasks list: every task must exist (404) and none may be completed (400).
async function checkPendingTasks(taskIds) {
    if (taskIds.length === 0) return {};
    var tasks = await Task.find({ _id: { $in: taskIds } }).select('_id completed');
    if (tasks.length !== taskIds.length) return { error: { status: 404, message: 'One or more tasks in pendingTasks do not exist.' } };
    if (tasks.some(function (t) { return t.completed; })) {
        return { error: { status: 400, message: 'A completed task cannot be in pendingTasks.' } };
    }
    return {};
}

// For a task body (already format-checked): resolve who it is assigned to.
// Fills in assignedUserName. Returns { user } (null when unassigned) or { error }.
async function checkAssignment(value) {
    var givenName = value.assignedUserName === '' ? undefined : value.assignedUserName;

    if (value.assignedUser === '') {
        if (givenName !== undefined && givenName !== UNASSIGNED.assignedUserName) {
            return { error: { status: 400, message: 'assignedUserName does not match the assigned user.' } };
        }
        value.assignedUserName = UNASSIGNED.assignedUserName;
        return { user: null };
    }

    var user = await User.findById(value.assignedUser);
    if (!user) return { error: { status: 404, message: 'The assigned user does not exist.' } };
    if (givenName !== undefined && givenName !== user.name) {
        return { error: { status: 400, message: 'assignedUserName does not match the name of the assigned user.' } };
    }
    value.assignedUserName = user.name;
    return { user: user };
}

// ---------- syncs (writes) ----------

// After a user is created/replaced: bring the tasks in line with its pendingTasks.
// oldIds is the previous pendingTasks ([] for a new user), newIds the saved list.
async function syncUserTasks(user, oldIds, newIds) {
    var uid = String(user._id);

    // Tasks that left the list: unassign them (only if they still point at this user).
    var removed = oldIds.filter(function (id) { return newIds.indexOf(id) === -1; });
    if (removed.length > 0) {
        await Task.updateMany({ _id: { $in: removed }, assignedUser: uid }, UNASSIGNED);
    }

    // Tasks that joined the list: take them away from any other user, then assign them here.
    if (newIds.length > 0) {
        await User.updateMany({ _id: { $ne: user._id } }, { $pull: { pendingTasks: { $in: newIds } } });
        await Task.updateMany({ _id: { $in: newIds } }, { assignedUser: uid, assignedUserName: user.name });
    }

    // Name may have changed: every task of this user (completed ones too) shows the current name.
    await Task.updateMany({ assignedUser: uid }, { assignedUserName: user.name });
}

// After a task is created/replaced: make the users' pendingTasks match.
// user is the assignee (or null). A pending task belongs only in its assignee's list.
async function syncTaskUsers(task, user) {
    var tid = String(task._id);
    var keeper = (user && !task.completed) ? user._id : null;

    var filter = { pendingTasks: tid };
    if (keeper) filter._id = { $ne: keeper };
    await User.updateMany(filter, { $pull: { pendingTasks: tid } });

    if (keeper) await User.updateOne({ _id: keeper }, { $addToSet: { pendingTasks: tid } });
}

// After a task is deleted: remove it from every pendingTasks list.
async function removeTaskFromUsers(taskId) {
    var tid = String(taskId);
    await User.updateMany({ pendingTasks: tid }, { $pull: { pendingTasks: tid } });
}

// After a user is deleted: all of their tasks (completed too) become unassigned.
async function unassignUserTasks(userId) {
    await Task.updateMany({ assignedUser: String(userId) }, UNASSIGNED);
}

module.exports = {
    checkPendingTasks: checkPendingTasks,
    checkAssignment: checkAssignment,
    syncUserTasks: syncUserTasks,
    syncTaskUsers: syncTaskUsers,
    removeTaskFromUsers: removeTaskFromUsers,
    unassignUserTasks: unassignUserTasks
};
