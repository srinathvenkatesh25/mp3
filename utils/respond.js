// Every response from the API has the same shape: { message, data }
function send(res, status, message, data) {
    return res.status(status).json({ message: message, data: data === undefined ? {} : data });
}

module.exports = {
    ok: function (res, data, message) { return send(res, 200, message || 'OK', data); },
    created: function (res, data, message) { return send(res, 201, message || 'Created', data); },
    // 204 means "success, nothing to send back", so there is deliberately no body
    noContent: function (res) { return res.status(204).end(); },
    badRequest: function (res, message) { return send(res, 400, message, {}); },
    notFound: function (res, message) { return send(res, 404, message, {}); },
    // err is { status, message }, as returned by the checks in references.js
    fail: function (res, err) { return send(res, err.status, err.message, {}); },
    serverError: function (res) { return send(res, 500, 'Something went wrong on the server. Please try again later.', {}); }
};
