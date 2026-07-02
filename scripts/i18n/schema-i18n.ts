import * as fs from 'node:fs';
import * as path from 'node:path';

import { dump, load, type Document as YamlDocument, type Node as YamlNode } from 'js-yaml';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

interface JsonObject {
    [key: string]: JsonValue;
}

interface TranslationEntry {
    en: string;
    translations: Record<string, string>;
}

interface SyncStats {
    added: number;
    preserved: number;
    cleared: number;
    removed: number;
}

/** 管理 Emmyrc schema 的翻译同步和中文 schema 生成流程. */
class SchemaI18nSync {
    private readonly schemaPath: string;
    private readonly translationYamlPath: string;
    private readonly languages: string[];
    private readonly languageSet: ReadonlySet<string>;

    constructor(private readonly projectRoot: string, languages: string[]) {
        const normalizedLanguages = new Set<string>();
        this.languages = [];
        for (const rawLanguage of languages) {
            const language = rawLanguage.trim();
            if (!language || language === '--') {
                continue;
            }

            const normalizedLanguage = language.toLowerCase();
            if (normalizedLanguage === 'en') {
                throw new Error('en is the source language and cannot be requested as a translation language.');
            }

            if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(language)) {
                throw new Error(`Invalid language tag: ${language}`);
            }

            if (normalizedLanguages.has(normalizedLanguage)) {
                throw new Error(`Duplicate language tag: ${language}`);
            }

            normalizedLanguages.add(normalizedLanguage);
            this.languages.push(language);
        }

        if (this.languages.length === 0) {
            throw new Error('Schema i18n sync requires at least one target language.');
        }

        this.languageSet = new Set(this.languages);
        this.schemaPath = path.join(projectRoot, 'schemas', 'emmyrc.schema.json');
        this.translationYamlPath = path.join(projectRoot, 'scripts', 'i18n', 'emmyrc.schema.i18n.yaml');
    }

    /** 同步 Emmyrc schema 翻译中心, 并生成当前中文 schema 产物. */
    run(): void {
        const parsedSchema: unknown = JSON.parse(fs.readFileSync(this.schemaPath, 'utf8'));
        if (!this.isJsonObject(parsedSchema)) {
            throw new Error(`${this.schemaPath} must contain a JSON object.`);
        }

        const schema = parsedSchema;
        // 原始 schema 是英文权威源, YAML 只保留翻译和上次同步时的英文快照.
        const descriptions = this.extractDescriptions(schema);
        const existingTranslations = this.readTranslationYaml();
        const { syncedTranslations, stats } = this.syncTranslations(descriptions, existingTranslations);

        fs.mkdirSync(path.dirname(this.translationYamlPath), { recursive: true });
        fs.writeFileSync(this.translationYamlPath, this.stringifyTranslationYaml(syncedTranslations), 'utf8');

        for (const language of this.languages) {
            const translatedSchemaPath = path.join(this.projectRoot, 'schemas', `emmyrc.schema.${language.toLowerCase()}.json`);
            const translatedSchema = this.translateDescriptions(schema, syncedTranslations, language);
            fs.writeFileSync(translatedSchemaPath, `${JSON.stringify(translatedSchema, null, 2)}\n`, 'utf8');
        }

        console.log(`Synced ${syncedTranslations.size} schema descriptions.`);
        console.log(
            `Translations: ${stats.preserved} preserved, ${stats.added} added, ${stats.cleared} cleared, ${stats.removed} removed.`,
        );
        console.log(`Updated ${path.relative(this.projectRoot, this.translationYamlPath)}.`);
        console.log(`Generated localized schemas for ${this.languages.join(', ')}.`);
    }

    /** 判断外部数据是否是可继续按对象字段读取的 JSON object. */
    private isJsonObject(value: unknown): value is JsonObject {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /** 从 schema 中收集所有 description 原文, 并映射为稳定可读的翻译 key. */
    private extractDescriptions(value: JsonValue, currentPath = '', descriptions = new Map<string, string>()): Map<string, string> {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) {
                this.extractDescriptions(value[index], currentPath ? `${currentPath}.${index}` : String(index), descriptions);
            }

            return descriptions;
        }

        if (!this.isJsonObject(value)) {
            return descriptions;
        }

        for (const [field, child] of Object.entries(value)) {
            if (field === 'description' && typeof child === 'string') {
                const readableKey = this.buildReadableKey(currentPath, value);
                if (readableKey) {
                    const existingDescription = descriptions.get(readableKey);
                    if (existingDescription !== undefined && existingDescription !== child) {
                        throw new Error(`Duplicate i18n key with different English text: ${readableKey}`);
                    }

                    descriptions.set(readableKey, child);
                }
            } else {
                this.extractDescriptions(child, currentPath ? `${currentPath}.${field}` : field, descriptions);
            }
        }

        return new Map([...descriptions.entries()].sort(([left], [right]) => left.localeCompare(right)));
    }

    /** 将 JSON Schema 路径转换成面向翻译维护者的可读 key. */
    private buildReadableKey(currentPath: string, currentObject: JsonObject): string {
        // 去掉 JSON Schema 的结构噪声, 让翻译 key 接近业务概念本身.
        let readableKey = currentPath
            .replace(/^\$defs\./, '')
            .replace(/\.properties\./g, '.')
            .replace(/\.oneOf\.\d+/g, '')
            .replace(/\.allOf\.\d+/g, '')
            .replace(/\.items/g, '')
            .replace(/\.additionalProperties/g, '')
            .replace(/^\.|\.$/g, '');

        if (currentPath.includes('.oneOf.') && typeof currentObject['const'] === 'string') {
            readableKey = readableKey ? `${readableKey}.${currentObject['const']}` : currentObject['const'];
        }

        return readableKey;
    }

    /** 读取已有翻译中心, 并校验每个条目的英文快照和目标语言字段. */
    private readTranslationYaml(): Map<string, TranslationEntry> {
        const translations = new Map<string, TranslationEntry>();
        if (!fs.existsSync(this.translationYamlPath)) {
            return translations;
        }

        const parsed = load(fs.readFileSync(this.translationYamlPath, 'utf8'));
        if (parsed === undefined) {
            return translations;
        }

        if (!this.isJsonObject(parsed)) {
            throw new Error(`${this.translationYamlPath} must contain a YAML mapping.`);
        }

        // 只读取当前传入的语言字段, 避免拼错语言名后被同步进产物.
        for (const [key, value] of Object.entries(parsed)) {
            if (!this.isJsonObject(value)) {
                throw new Error(`${this.translationYamlPath}: translation entry ${key} must be a mapping.`);
            }

            const en = value['en'];
            if (en !== undefined && typeof en !== 'string') {
                throw new Error(`${this.translationYamlPath}: ${key}.en must be a string.`);
            }

            const translationValues: Record<string, string> = {};
            for (const language of this.languages) {
                const translationValue = value[language];
                if (translationValue !== undefined && typeof translationValue !== 'string') {
                    throw new Error(`${this.translationYamlPath}: ${key}.${language} must be a string.`);
                }

                translationValues[language] = translationValue ?? '';
            }

            translations.set(key, {
                en: en ?? '',
                translations: translationValues,
            });
        }

        return translations;
    }

    /** 用当前 schema 原文刷新翻译中心, 英文变化时清空对应目标语言翻译. */
    private syncTranslations(
        descriptions: ReadonlyMap<string, string>,
        existingTranslations: ReadonlyMap<string, TranslationEntry>,
    ): { syncedTranslations: Map<string, TranslationEntry>; stats: SyncStats } {
        const syncedTranslations = new Map<string, TranslationEntry>();
        const stats: SyncStats = {
            added: 0,
            preserved: 0,
            cleared: 0,
            removed: 0,
        };

        for (const [key, en] of descriptions) {
            const existingTranslation = existingTranslations.get(key);
            const nextTranslations: Record<string, string> = {};
            if (!existingTranslation) {
                stats.added++;
                for (const language of this.languages) {
                    nextTranslations[language] = '';
                }

                syncedTranslations.set(key, { en, translations: nextTranslations });
                continue;
            }

            if (existingTranslation.en === en) {
                stats.preserved++;
                for (const language of this.languages) {
                    nextTranslations[language] = existingTranslation.translations[language] ?? '';
                }

                syncedTranslations.set(key, { en, translations: nextTranslations });
                continue;
            }

            // 英文原文变化时认为旧翻译失效, 避免目标语言继续描述旧语义.
            for (const language of this.languages) {
                if (existingTranslation.translations[language]) {
                    stats.cleared++;
                }

                nextTranslations[language] = '';
            }

            syncedTranslations.set(key, { en, translations: nextTranslations });
        }

        for (const key of existingTranslations.keys()) {
            if (!descriptions.has(key)) {
                stats.removed++;
            }
        }

        return { syncedTranslations, stats };
    }

    /** 将有效目标语言翻译应用到 schema 副本, 没有有效翻译时保留英文原文. */
    private translateDescriptions(
        value: JsonValue,
        translations: ReadonlyMap<string, TranslationEntry>,
        language: string,
        currentPath = '',
    ): JsonValue {
        if (Array.isArray(value)) {
            return value.map((item, index) => this.translateDescriptions(
                item,
                translations,
                language,
                currentPath ? `${currentPath}.${index}` : String(index),
            ));
        }

        if (!this.isJsonObject(value)) {
            return value;
        }

        const translated: JsonObject = {};
        for (const [field, child] of Object.entries(value)) {
            if (field === 'description' && typeof child === 'string') {
            const readableKey = this.buildReadableKey(currentPath, value);
            const translation = translations.get(readableKey);
            // 生成目标语言 schema 时再次校验英文快照, 防止未同步的旧翻译混入产物.
            const translatedText = translation?.translations[language] ?? '';
            translated[field] = translation?.en === child && translatedText ? translatedText : child;
        } else {
            translated[field] = this.translateDescriptions(child, translations, language, currentPath ? `${currentPath}.${field}` : field);
        }
        }

        return translated;
    }

    /** 输出可人工维护的 YAML 翻译中心, 保留多行原文和顶层 key 分块. */
    private stringifyTranslationYaml(translations: ReadonlyMap<string, TranslationEntry>): string {
        const header = [
            '# Generated by `pnpm run i18n:schema`.',
            `# Languages: ${this.languages.join(', ')}`,
            '',
            '',
        ].join('\n');
        const yamlData: Record<string, Record<string, string>> = {};

        for (const [key, translation] of translations) {
            const yamlEntry: Record<string, string> = { en: translation.en };
            for (const language of this.languages) {
                yamlEntry[language] = translation.translations[language] ?? '';
            }

            yamlData[key] = yamlEntry;
        }

        const dumpedYaml = dump(yamlData, {
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
            transform: (documents) => {
                for (const document of documents) {
                    this.markTranslationScalarsAsLiteral(document);
                }
            },
        });
        const spacedYamlLines: string[] = [];
        let hasTopLevelEntry = false;

        // 翻译中心按 key 分块展示, 让人工补译时更容易定位条目边界.
        for (const line of dumpedYaml.trimEnd().split('\n')) {
            const isTopLevelEntry = /^[^\s#][^:]*:$/.test(line);
            if (isTopLevelEntry && hasTopLevelEntry && spacedYamlLines.at(-1) !== '') {
                spacedYamlLines.push('');
            }

            if (isTopLevelEntry) {
                hasTopLevelEntry = true;
            }

            spacedYamlLines.push(line);
        }

        return `${header}${spacedYamlLines.join('\n')}\n`;
    }

    /** 让翻译字段用 YAML literal block 输出, 保持长文本和代码块可读. */
    private markTranslationScalarsAsLiteral(document: YamlDocument): void {
        const visit = (node: YamlNode | null, fieldName = ''): void => {
            if (!node) {
                return;
            }

            if (node.kind === 'mapping') {
                for (const item of node.items) {
                    const key = item.key.kind === 'scalar' ? item.key.value : '';
                    visit(item.value, key);
                }

                return;
            }

            if (node.kind === 'sequence') {
                for (const item of node.items) {
                    visit(item, fieldName);
                }

                return;
            }

            if (node.kind === 'scalar' && typeof node.value === 'string' && node.value && (fieldName === 'en' || this.languageSet.has(fieldName))) {
                node.style.literal = true;
            }
        };

        visit(document.contents);
    }
}

new SchemaI18nSync(process.cwd(), ['zh-CN']).run();
