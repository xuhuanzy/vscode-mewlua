import { spawnSync } from 'node:child_process';

const tagRef = [
    process.env.PRE_COMMIT_LOCAL_BRANCH ?? '',
    process.env.PRE_COMMIT_REMOTE_BRANCH ?? '',
].find((ref) => ref.startsWith('refs/tags/'));
const sourceRef = process.env.PRE_COMMIT_SOURCE ?? '';

if (!tagRef) {
    process.exit(0);
}

const tagName = tagRef.slice('refs/tags/'.length);
if (/^0{40}$/.test(sourceRef)) {
    console.log(`检测到 tag 删除 (${tagName}), 跳过 pnpm release.`);
    process.exit(0);
}

const shell = process.platform === 'win32';
const statusBefore = spawnSync('git', ['status', '--short'], {
    encoding: 'utf8',
    shell,
});
if (statusBefore.status !== 0) {
    process.exit(statusBefore.status ?? 1);
}

console.log(`检测到 tag 推送 (${tagName}), 开始执行 pnpm release.`);
const release = spawnSync('pnpm', ['run', 'release'], {
    stdio: 'inherit',
    shell,
});
if (release.error) {
    console.error(`执行 pnpm release 失败: ${release.error.message}`);
    process.exit(1);
}
if (release.status !== 0) {
    process.exit(release.status ?? 1);
}

const statusAfter = spawnSync('git', ['status', '--short'], {
    encoding: 'utf8',
    shell,
});
if (statusAfter.status !== 0) {
    process.exit(statusAfter.status ?? 1);
}

if (statusAfter.stdout !== statusBefore.stdout) {
    console.error('pnpm release 修改了工作区. 请先提交 release 输出, 然后重新创建 tag 再推送.');
    process.exit(1);
}
