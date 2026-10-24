/**
 * Calculator: /calc works out a maths expression: + - * / ^ %, brackets, sqrt, sin, cos, tan,
 * log, ln, abs, round, floor, ceil, pi, e. Shown only to you unless you choose to send it.
 * (A small parser, not eval: nothing but maths can run.)
 */
import { defineCorePlugin } from "..";
import { option, registerCommands, reply } from "../shared";

const STRING = 3, BOOLEAN = 5;

const FUNCTIONS: Record<string, (x: number) => number> = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
    sin: x => Math.sin(x), cos: x => Math.cos(x), tan: x => Math.tan(x),
    asin: Math.asin, acos: Math.acos, atan: Math.atan, log: Math.log10, ln: Math.log, exp: Math.exp,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 };

/** Evaluates an expression; throws with a readable message if it isn't valid. */
export function calculate(input: string): number {
    const src = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, "").toLowerCase();
    let pos = 0;
    const peek = () => src[pos];
    const skip = () => {
        while (src[pos] === " ") pos++;
    };
    const fail = (what: string): never => {
        throw new Error(`${what} at position ${pos + 1}`);
    };

    // expression := term (('+' | '-') term)*
    function expression(): number {
        let value = term();
        for (skip(); peek() === "+" || peek() === "-"; skip()) {
            const op = src[pos++];
            const right = term();
            value = op === "+" ? value + right : value - right;
        }
        return value;
    }
    // term := power (('*' | '/' | '%') power | power-with-implicit-multiplication)*
    function term(): number {
        let value = unary();
        for (skip(); ; skip()) {
            const op = peek();
            if (op === "*" || op === "/" || op === "%") {
                pos++;
                const right = unary();
                value = op === "*" ? value * right : op === "/" ? value / right : value % right;
            } else if (op === "(" || (op && /[a-zπ]/.test(op))) {
                value *= unary(); // 2pi, 3(4+1)
            } else return value;
        }
    }
    function unary(): number {
        skip();
        if (peek() === "-") { pos++; return -unary(); }
        if (peek() === "+") { pos++; return unary(); }
        return power();
    }
    // power := factor ('^' unary)?   (right-associative)
    function power(): number {
        const base = factor();
        skip();
        if (peek() === "^") {
            pos++;
            return Math.pow(base, unary());
        }
        return base;
    }
    function factor(): number {
        skip();
        const c = peek();
        if (c === undefined) fail("Expression ended early");
        if (c === "(") {
            pos++;
            const value = expression();
            skip();
            if (peek() !== ")") fail("Missing )");
            pos++;
            return postfix(value);
        }
        const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(src.slice(pos));
        if (number) {
            pos += number[0].length;
            return postfix(parseFloat(number[0]));
        }
        const word = /^[a-zπ]+/.exec(src.slice(pos));
        if (word) {
            const name = word[0];
            pos += name.length;
            if (name in CONSTANTS) return postfix(CONSTANTS[name]);
            if (name in FUNCTIONS) return postfix(FUNCTIONS[name](unary()));
            fail(`Unknown "${name}"`);
        }
        return fail(`Unexpected "${c}"`);
    }
    // 5! factorial
    function postfix(value: number): number {
        skip();
        while (peek() === "!") {
            pos++;
            if (value < 0 || value > 170 || value % 1) fail("Factorial needs a whole number up to 170");
            let f = 1;
            for (let i = 2; i <= value; i++) f *= i;
            value = f;
        }
        return value;
    }

    const value = expression();
    skip();
    if (pos < src.length) fail(`Unexpected "${src[pos]}"`);
    return value;
}

export function formatNumber(n: number): string {
    if (!isFinite(n)) return isNaN(n) ? "not a number" : n > 0 ? "∞" : "-∞";
    if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toLocaleString?.("en-US") ?? String(n);
    return String(Number(n.toPrecision(12)));
}

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.calculator",
        name: "Calculator",
        version: "1.0.0",
        description: "/calc works out maths like 2^10, sqrt(2), 15% of things, (3+4)*2 or 5!.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = registerCommands([{
            name: "calc",
            description: "Work out a maths expression",
            options: [
                { name: "expression", displayName: "expression", description: "Like (3+4)*2, 2^10, sqrt(2), 5!", type: STRING, required: true },
                { name: "send", displayName: "send", description: "Send the answer to the chat", type: BOOLEAN },
            ],
            execute(args: any[], ctx: any) {
                const expression = String(option(args, "expression") ?? "");
                try {
                    const content = `${expression} = **${formatNumber(calculate(expression))}**`;
                    if (option(args, "send")) return { content };
                    reply(ctx.channel.id, content);
                } catch (e: any) {
                    reply(ctx.channel.id, `Couldn't work that out: ${e?.message ?? e}`);
                }
            },
        }]);
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
