// Small validation helpers shared by the user and task routes.

// A Mongo ObjectId is exactly 24 hex characters.
function isId(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

// Returns a Date for strings/numbers that make a real date, otherwise null.
function toDate(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    // "1700000000000" (a timestamp sent as text) is a date; new Date() alone would reject it.
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

// Accepts true/false and the strings "true"/"false" (form-encoded bodies send strings).
// Returns true, false, or null when the value is not a boolean.
function toBoolean(value) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return null;
}

module.exports = {
    isId: isId,
    isNonEmptyString: isNonEmptyString,
    toDate: toDate,
    toBoolean: toBoolean
};
