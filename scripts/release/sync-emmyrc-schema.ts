import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { load } from 'js-yaml';

interface EmmyrcSchemaConfig {
    schema: {
        upstreamUrl: string;
        outputPath: string;
    };
}

export async function syncEmmyrcSchema(projectRoot = process.cwd()): Promise<void> {
    const configPath = path.join(projectRoot, 'scripts', 'release', 'release.yaml');
    const rawConfig: unknown = load(fs.readFileSync(configPath, 'utf8'));

    if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
        throw new Error(`${path.relative(projectRoot, configPath)} 必须是 YAML 映射.`);
    }

    const rawSchemaConfig = (rawConfig as Record<string, unknown>)['schema'];
    if (typeof rawSchemaConfig !== 'object' || rawSchemaConfig === null || Array.isArray(rawSchemaConfig)) {
        throw new Error(`${path.relative(projectRoot, configPath)} 必须定义 schema 映射.`);
    }

    const config: EmmyrcSchemaConfig = {
        schema: {
            upstreamUrl: (rawSchemaConfig as Record<string, unknown>)['upstreamUrl'] as string,
            outputPath: (rawSchemaConfig as Record<string, unknown>)['outputPath'] as string,
        },
    };

    if (typeof config.schema.upstreamUrl !== 'string' || typeof config.schema.outputPath !== 'string') {
        throw new Error(`${path.relative(projectRoot, configPath)} 必须定义 schema.upstreamUrl 和 schema.outputPath.`);
    }

    console.log('开始同步 emmyrc schema.');
    const response = await fetch(config.schema.upstreamUrl);
    if (!response.ok) {
        throw new Error(`拉取 ${config.schema.upstreamUrl} 失败: ${response.status} ${response.statusText}`);
    }

    const upstreamSchema: unknown = JSON.parse(await response.text());
    if (typeof upstreamSchema !== 'object' || upstreamSchema === null || Array.isArray(upstreamSchema)) {
        throw new Error('上游 emmyrc schema 必须是 JSON 对象.');
    }

    const outputPath = path.resolve(projectRoot, config.schema.outputPath);
    const relativeOutputPath = path.relative(projectRoot, outputPath);
    if (relativeOutputPath.startsWith('..') || path.isAbsolute(relativeOutputPath)) {
        throw new Error(`拒绝写入项目目录外的路径: ${config.schema.outputPath}`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(upstreamSchema, null, 2)}\n`, 'utf8');
    console.log(`已从 ${config.schema.upstreamUrl} 更新 ${relativeOutputPath}.`);

    const schemaI18n = spawnSync(process.execPath, [path.join(projectRoot, 'out', 'scripts', 'i18n', 'schema-i18n.js')], {
        cwd: projectRoot,
        stdio: 'inherit',
    });

    if (schemaI18n.error) {
        throw new Error(`生成 emmyrc schema i18n 失败: ${schemaI18n.error.message}`);
    }

    if (schemaI18n.status !== 0) {
        throw new Error(`生成 emmyrc schema i18n 失败, 退出码: ${schemaI18n.status ?? '未知'}.`);
    }
}
