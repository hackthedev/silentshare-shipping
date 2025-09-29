export function calculateConsensus(votes, tolerance = null) {
    if (!votes || votes.length === 0) {
        return { value: null, result: [], disqualified: [] };
    }

    // get median
    const values = votes.map(v => v[1]).sort((a, b) => a - b);
    const median = values.length % 2 === 0
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        : values[Math.floor(values.length / 2)];

    let sumWeighted = 0;
    let sumWeights = 0;

    const result = [];
    const disqualified = [];

    for (const [host, reportedValue, weight] of votes) {
        if (tolerance !== null && Math.abs(reportedValue - median) > tolerance) {
            disqualified.push([host, reportedValue, weight]);
            continue;
        }
        result.push([host, reportedValue, weight]);
        sumWeighted += reportedValue * weight;
        sumWeights += weight;
    }

    const value = sumWeights > 0 ? parseFloat((sumWeighted / sumWeights).toFixed(2)) : null;

    return { value, result, disqualified };
}
