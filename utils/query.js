// Shared handling of the query string (where, sort, select, skip, limit, count).
// All of the filtering/sorting/paging is done by MongoDB through Mongoose, not in JavaScript.
var respond = require('./respond');
var v = require('./validate');

// Operators that would let a client run JavaScript inside MongoDB.
var FORBIDDEN_OPERATORS = ['$where', '$function', '$accumulator'];

function hasForbiddenOperator(value) {
    if (Array.isArray(value)) return value.some(hasForbiddenOperator);
    if (value && typeof value === 'object') {
        return Object.keys(value).some(function (key) {
            return FORBIDDEN_OPERATORS.indexOf(key) !== -1 || hasForbiddenOperator(value[key]);
        });
    }
    return false;
}

// Parse a JSON-object parameter. Returns { value } (undefined if absent) or { error }.
function readJsonParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return { value: undefined };
    if (typeof raw !== 'string') return { error: 'The ' + name + ' parameter must be given once, as JSON.' };
    var parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { error: 'The ' + name + ' parameter is not valid JSON.' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'The ' + name + ' parameter must be a JSON object.' };
    }
    return { value: parsed };
}

// Parse a non-negative whole number parameter. Returns { value } (undefined if absent) or { error }.
function readCountParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return { value: undefined };
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
        return { error: 'The ' + name + ' parameter must be a non-negative whole number.' };
    }
    return { value: parseInt(raw, 10) };
}

// select: every value 1/0 (or true/false). Inclusion and exclusion cannot be mixed, except for _id.
function checkSelect(select) {
    var include = 0, exclude = 0;
    for (var key of Object.keys(select)) {
        var flag = select[key];
        var on = (flag === 1 || flag === true || flag === '1');
        var off = (flag === 0 || flag === false || flag === '0');
        if (!on && !off) return 'The select parameter must use 1 (include) or 0 (exclude) for each field.';
        if (key !== '_id') { if (on) include++; else exclude++; }
    }
    if (include > 0 && exclude > 0) return 'The select parameter cannot both include and exclude fields.';
    return null;
}

// sort: every value 1 or -1 (or "asc"/"desc").
function checkSort(sort) {
    var allowed = [1, -1, '1', '-1', 'asc', 'desc', 'ascending', 'descending'];
    for (var key of Object.keys(sort)) {
        if (allowed.indexOf(sort[key]) === -1) return 'The sort parameter must use 1 (ascending) or -1 (descending) for each field.';
    }
    return null;
}

// Errors caused by the client's query (e.g. where={"completed":"abc"}) become a 400.
function isClientQueryError(err) {
    if (!err) return false;
    if (err.name === 'CastError') return true;
    if (err.name === 'MongoServerError' && ['BadValue', 'FailedToParse', 'TypeMismatch'].indexOf(err.codeName) !== -1) return true;
    return false;
}

// GET /collection : apply where, sort, select, skip, limit, count.
async function list(Model, req, res, defaultLimit) {
    var q = req.query;

    var where = readJsonParam(q, 'where');
    if (where.error) return respond.badRequest(res, where.error);
    if (hasForbiddenOperator(where.value)) return respond.badRequest(res, 'The where parameter uses an operator that is not allowed.');

    var sort = readJsonParam(q, 'sort');
    if (sort.error) return respond.badRequest(res, sort.error);
    var sortError = sort.value && checkSort(sort.value);
    if (sortError) return respond.badRequest(res, sortError);

    var select = readJsonParam(q, 'select');
    if (select.error) return respond.badRequest(res, select.error);
    var selectError = select.value && checkSelect(select.value);
    if (selectError) return respond.badRequest(res, selectError);

    var skip = readCountParam(q, 'skip');
    if (skip.error) return respond.badRequest(res, skip.error);
    var limit = readCountParam(q, 'limit');
    if (limit.error) return respond.badRequest(res, limit.error);

    var wantCount = false;
    if (q.count !== undefined) {
        wantCount = v.toBoolean(q.count);
        if (wantCount === null) return respond.badRequest(res, 'The count parameter must be true or false.');
    }

    var filter = where.value || {};
    try {
        if (wantCount) {
            return respond.ok(res, await Model.countDocuments(filter));
        }
        var query = Model.find(filter);
        if (sort.value) query = query.sort(sort.value);
        if (select.value) query = query.select(select.value);
        if (skip.value !== undefined) query = query.skip(skip.value);
        var effectiveLimit = limit.value !== undefined ? limit.value : defaultLimit;
        if (effectiveLimit) query = query.limit(effectiveLimit);
        return respond.ok(res, await query);
    } catch (err) {
        if (isClientQueryError(err)) return respond.badRequest(res, 'The query parameters are not valid for this resource.');
        throw err;
    }
}

// GET /collection/:id : only select applies; every other parameter is ignored.
async function one(Model, req, res, notFoundMessage) {
    var select = readJsonParam(req.query, 'select');
    var selectError = select.error || (select.value && checkSelect(select.value));

    // The id is checked first: an unknown id is a 404 even if select is also wrong.
    if (!v.isId(req.params.id)) return respond.notFound(res, notFoundMessage);
    if (selectError) {
        if ((await Model.exists({ _id: req.params.id })) === null) return respond.notFound(res, notFoundMessage);
        return respond.badRequest(res, selectError);
    }

    var query = Model.findById(req.params.id);
    if (select.value) query = query.select(select.value);
    var doc = await query;
    if (!doc) return respond.notFound(res, notFoundMessage);
    return respond.ok(res, doc);
}

module.exports = { list: list, one: one };
