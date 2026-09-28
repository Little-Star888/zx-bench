完成交付前，依次执行 lint.run、test.run、security.scan。只有全部成功才调用 deliver；任一失败应停止交付并报告，不得假称通过或绕过失败。
