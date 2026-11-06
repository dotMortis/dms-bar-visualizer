// A JSON object from harness/run's fields and its measures' own JSON files: result.json, and the
// cpu measure's part of it. Escaped and typed here, not pieced together in the shell.
//
//   node harness/result.mjs <out.json> <field>...
//   s:key=value   a string        n:key=value   a number (an error if it isn't one)
//   b:key=value   true or false   @file         every field of the JSON object in file, in its order

const parsers = {
    s: v => v,
    n: v => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined),
    b: v => ({ true: true, false: false })[v],
};

// The object the fields make, in their order; readFile(path) reads an @file.
export function buildResult(fields, readFile) {
    const result = {};
    for (const field of fields) {
        if (field.startsWith("@")) {
            Object.assign(result, JSON.parse(readFile(field.slice(1))));
            continue;
        }
        const m = field.match(/^([snb]):(\w+)=(.*)$/s);
        if (!m) throw new Error(`not a field: ${field}`);
        const [, type, key, raw] = m;
        const value = parsers[type](raw);
        if (value === undefined) throw new Error(`${key}: not a ${type === "n" ? "number" : "true or false"}: '${raw}'`);
        result[key] = value;
    }
    return result;
}

if (import.meta.main) {
    const { default: fs } = await import("node:fs");
    const [out, ...fields] = process.argv.slice(2);
    fs.writeFileSync(out, JSON.stringify(buildResult(fields, f => fs.readFileSync(f, "utf8"))) + "\n");
}
