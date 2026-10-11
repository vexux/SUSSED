const DEFAULT_ROUND_COUNT = 5;
const SUPPORTED_ROUND_COUNTS = Object.freeze([5, 7, 10]);

function isSupportedRoundCount(value) {
    return SUPPORTED_ROUND_COUNTS.includes(value);
}

module.exports = {
    DEFAULT_ROUND_COUNT,
    SUPPORTED_ROUND_COUNTS,
    isSupportedRoundCount
};
