import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const oniguruma = require('vscode-oniguruma');
const vscodeTextmate = require('vscode-textmate');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let luaGrammarPromise;

async function loadLuaGrammar() {
	if (!luaGrammarPromise) {
		luaGrammarPromise = (async () => {
			const wasmPath = path.join(repoRoot, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm');
			const wasmBytes = fs.readFileSync(wasmPath);
			await oniguruma.loadWASM(
				wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
			);

			const registry = new vscodeTextmate.Registry({
				onigLib: Promise.resolve({
					createOnigScanner(patterns) {
						return new oniguruma.OnigScanner(patterns);
					},
					createOnigString(value) {
						return new oniguruma.OnigString(value);
					},
				}),
				loadGrammar(scopeName) {
					if (scopeName !== 'source.lua') {
						return Promise.resolve(null);
					}

					const grammarPath = path.join(repoRoot, 'syntaxes', 'lua.tmLanguage.json');
					return Promise.resolve(JSON.parse(fs.readFileSync(grammarPath, 'utf8')));
				},
			});

			return registry.loadGrammar('source.lua');
		})();
	}

	return luaGrammarPromise;
}

async function tokenizeLua(code) {
	const grammar = await loadLuaGrammar();
	let ruleStack = null;

	return code.split(/\r?\n/).map((line) => {
		const result = grammar.tokenizeLine(line, ruleStack);
		ruleStack = result.ruleStack;

		return result.tokens.map((token) => ({
			text: line.slice(token.startIndex, token.endIndex),
			scopes: token.scopes,
		}));
	});
}

function findToken(lines, lineNumber, text) {
	const token = lines[lineNumber - 1].find((candidate) => candidate.text === text);
	assert.ok(token, `Expected to find token ${JSON.stringify(text)} on line ${lineNumber}.`);
	return token;
}

test('function return names after a nested fun parameter are parsed as return variables', async () => {
	const lines = await tokenizeLua(`local function name2(value: fun(v1: string) -> integer)
  -> age: number
  2. v1: number`);

	const nestedParameter = findToken(lines, 1, 'v1');
	assert.ok(nestedParameter.scopes.includes('variable.other.lua'), 'nested fun parameter should stay a parameter name.');
	assert.ok(findToken(lines, 1, 'integer').scopes.includes('support.type.primitive.lua'));

	const age = findToken(lines, 2, 'age');
	assert.ok(age.scopes.includes('variable.other.lua'), 'age should be highlighted as a return variable.');
	assert.ok(!age.scopes.includes('meta.parameter.lua'), 'age should not stay inside the parameter list.');
	assert.ok(!age.scopes.includes('meta.function.lua'), 'age should not stay inside the function signature.');

	const secondReturnName = findToken(lines, 3, 'v1');
	assert.ok(secondReturnName.scopes.includes('variable.other.lua'), 'numbered return name should be a return variable.');
	assert.ok(!secondReturnName.scopes.includes('meta.parameter.lua'), 'numbered return should not stay inside the parameter list.');
	assert.ok(!secondReturnName.scopes.includes('meta.function.lua'), 'numbered return should not stay inside the function signature.');

	assert.ok(findToken(lines, 2, 'number').scopes.includes('support.type.primitive.lua'));
	assert.ok(findToken(lines, 3, 'number').scopes.includes('support.type.primitive.lua'));
});
