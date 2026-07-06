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

test('numeric literal patterns keep their scopes after grouping', async () => {
	const lines = await tokenizeLua('local values = { 0x1.8p1, 0x10p-2, 0xff, 1., 1e2, .5, 42 }');

	assert.ok(findToken(lines, 1, '0x1.8p1').scopes.includes('constant.numeric.float.hexadecimal.lua'));
	assert.ok(findToken(lines, 1, '0x10p-2').scopes.includes('constant.numeric.float.hexadecimal.lua'));
	assert.ok(findToken(lines, 1, '0xff').scopes.includes('constant.numeric.integer.hexadecimal.lua'));
	assert.ok(findToken(lines, 1, '1.').scopes.includes('constant.numeric.float.lua'));
	assert.ok(findToken(lines, 1, '1e2').scopes.includes('constant.numeric.float.lua'));
	assert.ok(findToken(lines, 1, '.5').scopes.includes('constant.numeric.float.lua'));
	assert.ok(findToken(lines, 1, '42').scopes.includes('constant.numeric.integer.lua'));
});

test('class field numeric initializers keep numeric scopes', async () => {
	const lines = await tokenizeLua(`(class) A {
    one: integer = "123",
    two: integer = 234,
}`);

	const value = findToken(lines, 3, '234');
	assert.ok(value.scopes.includes('meta.field.declaration.lua'));
	assert.ok(value.scopes.includes('constant.numeric.integer.lua'));
});

test('numeric literal types keep numeric scopes', async () => {
	const lines = await tokenizeLua('local function test(v: 1)');

	const value = findToken(lines, 1, '1');
	assert.ok(value.scopes.includes('meta.parameter.lua'));
	assert.ok(value.scopes.includes('constant.numeric.integer.lua'));
});

test('class indexer declarations reuse type scopes', async () => {
	const lines = await tokenizeLua(`(class) B {
    [integer]: string,
}`);

	const keyType = findToken(lines, 2, 'integer');
	assert.ok(keyType.scopes.includes('meta.class.body.lua'));
	assert.ok(keyType.scopes.includes('support.type.primitive.lua'));

	const valueType = findToken(lines, 2, 'string');
	assert.ok(valueType.scopes.includes('meta.class.body.lua'));
	assert.ok(valueType.scopes.includes('support.type.primitive.lua'));
});

test('grouped emmydoc tags keep annotation and type scopes', async () => {
	const lines = await tokenizeLua(`---@type number
---@overload fun(): string
---@deprecated use replacement
---@private`);

	assert.ok(findToken(lines, 1, '@type').scopes.includes('storage.type.annotation.lua'));
	assert.ok(findToken(lines, 1, 'number').scopes.includes('support.type.primitive.lua'));
	assert.ok(findToken(lines, 2, '@overload').scopes.includes('storage.type.annotation.lua'));
	assert.ok(findToken(lines, 2, 'fun').scopes.includes('keyword.control.lua'));
	assert.ok(findToken(lines, 3, '@deprecated').scopes.includes('storage.type.annotation.lua'));
	assert.ok(findToken(lines, 4, '@private').scopes.includes('storage.type.annotation.lua'));
});

test('inlined type helper patterns keep their scopes', async () => {
	const lines = await tokenizeLua(`---@class Box<T extends string = number>
---@type value extends infer T`);

	assert.ok(findToken(lines, 1, 'extends').scopes.includes('storage.modifier.lua'));
	assert.ok(findToken(lines, 1, '=').scopes.includes('keyword.operator.assignment.lua'));
	assert.ok(findToken(lines, 1, 'number').scopes.includes('support.type.primitive.lua'));
	assert.ok(findToken(lines, 2, 'infer').scopes.includes('keyword.operator.expression.infer.lua'));
	assert.ok(findToken(lines, 2, 'T').scopes.includes('entity.name.type.lua'));
});

test('object type keys in aliases are parsed as properties', async () => {
	const lines = await tokenizeLua('---@alias User1 { name: string, age?: integer }');

	const name = findToken(lines, 1, 'name');
	assert.ok(name.scopes.includes('variable.object.property.lua'));
	assert.ok(!name.scopes.includes('entity.name.type.lua'));

	const age = findToken(lines, 1, 'age');
	assert.ok(age.scopes.includes('variable.object.property.lua'));
	assert.ok(!age.scopes.includes('entity.name.type.lua'));

	assert.ok(findToken(lines, 1, 'integer').scopes.includes('support.type.primitive.lua'));
});
