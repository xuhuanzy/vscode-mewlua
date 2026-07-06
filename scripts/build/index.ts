import { syncEmmyrcSchema } from './sync-emmyrc-schema';

async function main(): Promise<void> {
    const projectRoot = process.cwd();
    const buildTasks: Record<string, () => Promise<void>> = {
        'sync-emmyrc-schema': () => syncEmmyrcSchema(projectRoot),
    };

    const args = process.argv
        .slice(2)
        .map((arg) => arg.startsWith('--') ? arg.slice(2) : arg)
        .filter((arg) => arg.length > 0);
    if (args.includes('help') || args.includes('-h')) {
        console.log(`用法: pnpm run build -- [all|${Object.keys(buildTasks).join('|')}]\n默认: all`);
        return;
    }

    const taskNames = args.length === 0 || args.includes('all') ? Object.keys(buildTasks) : args;
    for (const taskName of taskNames) {
        const task = buildTasks[taskName];
        if (!task) {
            throw new Error(`未知构建任务: ${taskName}. 可用任务: all, ${Object.keys(buildTasks).join(', ')}.`);
        }
        await task();
    }

    console.log('构建脚本执行完成.');
}

main().catch((error: unknown) => {
    console.error(`构建失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
