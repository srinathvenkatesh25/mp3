var User = require('../models/user');
var respond = require('../utils/respond');
var v = require('../utils/validate');
var query = require('../utils/query');
var refs = require('../utils/references');

// Check the request body and return { error } or { value } with only the fields we allow.
// Anything else the client sends (_id, dateCreated, ...) is ignored.
function readUserBody(body, isForm) {
    body = body || {};
    if (!v.isNonEmptyString(body.name)) return { error: 'A user needs a name.' };
    if (!v.isNonEmptyString(body.email)) return { error: 'A user needs an email.' };

    var pendingTasks = [];
    if (body.pendingTasks !== undefined) {
        pendingTasks = body.pendingTasks;
        // Form-encoded bodies send a single value as a plain string, and an empty field as "".
        if (isForm && typeof pendingTasks === 'string') pendingTasks = pendingTasks === '' ? [] : [pendingTasks];
        if (!Array.isArray(pendingTasks)) return { error: 'pendingTasks must be a list of task ids.' };
        for (var i = 0; i < pendingTasks.length; i++) {
            if (!v.isId(pendingTasks[i])) return { error: 'pendingTasks must be a list of valid task ids.' };
        }
        pendingTasks = pendingTasks.filter(function (id, index) { return pendingTasks.indexOf(id) === index; });
    }
    return { value: { name: body.name.trim(), email: body.email.trim(), pendingTasks: pendingTasks } };
}

// True if another user (not excludeId) already has this email.
async function emailTaken(email, excludeId) {
    var filter = { email: email };
    if (excludeId) filter._id = { $ne: excludeId };
    return (await User.exists(filter)) !== null;
}

// The unique index can still reject a simultaneous duplicate; report that as a 400 too.
function isDuplicateKey(err) {
    return err && err.code === 11000;
}

module.exports = function (router) {

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        await query.list(User, req, res, 0);
    });

    usersRoute.post(async function (req, res) {
        var parsed = readUserBody(req.body, req.is('urlencoded'));
        if (parsed.error) return respond.badRequest(res, parsed.error);
        if (await emailTaken(parsed.value.email)) return respond.badRequest(res, 'A user with this email already exists.');

        var check = await refs.checkPendingTasks(parsed.value.pendingTasks);
        if (check.error) return respond.fail(res, check.error);

        var user;
        try {
            user = await User.create(parsed.value);
        } catch (err) {
            if (isDuplicateKey(err)) return respond.badRequest(res, 'A user with this email already exists.');
            throw err;
        }
        await refs.syncUserTasks(user, [], parsed.value.pendingTasks);
        respond.created(res, user);
    });

    userRoute.get(async function (req, res) {
        await query.one(User, req, res, 'User not found.');
    });

    userRoute.put(async function (req, res) {
        var user = v.isId(req.params.id) ? await User.findById(req.params.id) : null;
        if (!user) return respond.notFound(res, 'User not found.');

        var parsed = readUserBody(req.body, req.is('urlencoded'));
        if (parsed.error) return respond.badRequest(res, parsed.error);
        if (await emailTaken(parsed.value.email, user._id)) return respond.badRequest(res, 'A user with this email already exists.');

        var check = await refs.checkPendingTasks(parsed.value.pendingTasks);
        if (check.error) return respond.fail(res, check.error);

        var oldTasks = user.pendingTasks.slice();
        user.name = parsed.value.name;
        user.email = parsed.value.email;
        user.pendingTasks = parsed.value.pendingTasks;
        try {
            await user.save();
        } catch (err) {
            if (isDuplicateKey(err)) return respond.badRequest(res, 'A user with this email already exists.');
            throw err;
        }
        await refs.syncUserTasks(user, oldTasks, parsed.value.pendingTasks);
        respond.ok(res, user);
    });

    userRoute.delete(async function (req, res) {
        var user = v.isId(req.params.id) ? await User.findByIdAndDelete(req.params.id) : null;
        if (!user) return respond.notFound(res, 'User not found.');
        await refs.unassignUserTasks(user._id);
        respond.ok(res, user, 'User deleted.');
    });

    return router;
};
