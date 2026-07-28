const BJT_OFFSET_MS = 8 * 60 * 60 * 1000;

function nextBjtTime(hour, minute = 0, now = new Date()) {
    const bjtNow = new Date(now.getTime() + BJT_OFFSET_MS);
    const targetUtcMs = Date.UTC(
        bjtNow.getUTCFullYear(),
        bjtNow.getUTCMonth(),
        bjtNow.getUTCDate(),
        hour - 8,
        minute,
        0,
        0
    );
    let target = new Date(targetUtcMs);
    if (target <= now) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
    return target;
}

module.exports = { nextBjtTime };
