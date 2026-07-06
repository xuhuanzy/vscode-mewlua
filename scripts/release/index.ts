import { syncEmmyrcSchema } from './sync-emmyrc-schema';

async function main(): Promise<void> {
    const projectRoot = process.cwd();
    const releaseTasks: Record<string, () => Promise<void>> = {
        'sync-emmyrc-schema': () => syncEmmyrcSchema(projectRoot),
    };

    const args = process.argv
        .slice(2)
        .map((arg) => arg.startsWith('--') ? arg.slice(2) : arg)
        .filter((arg) => arg.length > 0);
    if (args.includes('help') || args.includes('-h')) {
        console.log(`用法: pnpm run release -- [all|${Object.keys(releaseTasks).join('|')}]\n默认: all`);
        return;
    }

    const taskNames = args.length === 0 || args.includes('all') ? Object.keys(releaseTasks) : args;
    for (const taskName of taskNames) {
        const task = releaseTasks[taskName];
        if (!task) {
            throw new Error(`未知发布任务: ${taskName}. 可用任务: all, ${Object.keys(releaseTasks).join(', ')}.`);
        }
        await task();
    }

    console.log('发布脚本执行完成.');
}

main().catch((error: unknown) => {
    console.error(`发布失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
