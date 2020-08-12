const glob = require('glob');
const transformFileSync = require('@babel/core').transformFileSync;
const fs = require('fs');
const rimraf = require('rimraf');
const t = require('@babel/types');
const config = require('../../i18n.config.js')();

const textArr = [];
const zhCH = new Map();

const targetDir = config.targetDir;
const exclude = config.exclude;
const callExpression = config.callExpression;
const autoZhKey = config.autoZhKey;

const replaceLineBreak = function (value) {
    if (typeof value !== 'string') return value
    return value.replace(/\n/g, ' ')
}

const baseType = function (v) {
    return Object.prototype.toString.call(v)
}
const judgeChinese = function (text) {
    return /[\u4e00-\u9fa5]/.test(text);
}

function run(path) {
    glob(`${path}/**/*.{js,jsx,ts,tsx}`, { ignore: exclude.map(pattern => `${path}/${pattern}`) }, (error, files) => {
        files.forEach(filename => {
            if (filename.includes('node_modules')) {
                return;
            }
            // 如果文件目录带了_，我认为他是测试用例
            if (filename.indexOf('_') !== -1) {
                return;
            }
            transformFileSync(filename, {
                presets: [
                    ["@babel/preset-typescript", { allExtensions: true, isTSX: true }],
                    [
                        "@babel/env",
                        {
                            "targets": "chrome > 58",
                            "modules": false,
                            loose: true,
                        }
                    ],
                    "@babel/preset-react"],
                plugins: [
                    "@babel/plugin-transform-typescript",
                    "@babel/plugin-syntax-typescript",
                    "@babel/plugin-syntax-jsx",
                    ["@babel/plugin-proposal-decorators", { "legacy": true }],
                    "@babel/plugin-proposal-class-properties",
                    "@babel/plugin-proposal-object-rest-spread",
                    "@babel/plugin-syntax-dynamic-import",
                    scan,
                ]
            });
        });

        // 这里写到text中，为了避免重复
        // 创建文件夹
        rimraf.sync(targetDir);
        fs.mkdirSync(targetDir);
        fs.appendFile(`${targetDir}/sourcemap.txt`, textArr.map((item, i) => `${item}#${i}\n`).join(''), function (err) {
            if (err) {
                return console.error(err);
            }
            console.log(`----共扫描中文文案 ${textArr.length} 条----`);
        });
        fs.appendFile(`${targetDir}/zh-CH.json`, `${JSON.stringify([...zhCH.values()], null, '\t')}`, function (err) {
            if (err) {
                return console.error(err);
            }
            console.log(`----去重后中文文案为 ${zhCH.size} 条----`);
        });
    });
}

function scan({ types: t }) {
    return {
        visitor: {
            JSXAttribute(path) {
                const { node } = path;
                if (node.name.name !== 'defaultMessage' && path.node.value) {
                    detectChinese(node.value.value, path, 'jsx', 'JSXAttribute');
                }
            },
            JSXText(path) {
                const { node } = path;
                detectChinese(node.value, path, 'jsx', 'JSXText');
            },
            AssignmentExpression(path) {
                detectChinese(path.node.right.value, path, 'text', 'AssignmentExpression');
            },
            ObjectProperty(path) {
                detectChinese(path.node.value.value, path, 'text', 'ObjectProperty');
            },
            ArrayExpression(path) {
                path.node.elements.forEach(item => {
                    if (item.value) {
                        detectChinese(item.value, Object.assign({}, path, { node: item }), 'text', 'ArrayExpression');
                    }
                })
            },
            // 新增：new Person('小红')
            NewExpression(path) {
                path.node.arguments.forEach(item => {
                    detectChinese(item && item.value, path, 'text', 'NewExpression');
                });
            },
            // 新增：函数调用；cb('这是一个错误')
            CallExpression(path) {
                if (path.node.callee && path.node.callee.object) {
                    if (path.node.callee.object.name === 'console') {
                        return;
                    }
                    if (path.node.callee.object.name === 'React') {
                        return;
                    }
                }

                path.node.arguments.forEach(item => {
                    callExpression && detectChinese(item && item.value, path, 'text', 'CallExpression');
                });
            },
            // 新增：case '这是中文'；switchStatement, 
            SwitchCase(path) {
                if (path.node && path.node.test) {
                    detectChinese(path.node.test.value, path, 'text', 'SwitchCase');
                }
            },
            TemplateLiteral(path) {
                if (!path.node.quasis.every(word => !judgeChinese(word))) {
                    path.skip();
                    return
                }
                const tempArr = [].concat(path.node.quasis, path.node.expressions).sort(function (a, b) {
                    return a.start - b.start;
                })
                let isreplace = false;
                let v = '';
                tempArr.forEach(function (t) {
                    if (t.type === 'TemplateElement') {
                        v = `${replaceLineBreak(t.value.cooked)}`;
                        if (judgeChinese(t.value.cooked)) {
                            detectChinese(v, path, 'template', 'TemplateLiteral');
                            isreplace = true;
                        }
                    } else if (t.type === 'Identifier') {
                        isreplace = false;
                        // variable[t.name] = t.name;
                        // v += `{${t.name}}`
                    } else if (t.type === 'CallExpression') {
                        isreplace = false;
                    } else {
                        isreplace = false;
                    }

                })
                if (!isreplace) {
                    path.skip();
                    return
                }
                if (v.trim() === '') {
                    path.skip();
                    return
                }
                path.skip();
            },
        },

    }
}

function detectChinese(text, path, type, babelType) {
    if (/[\u4e00-\u9fa5]/.test(text)) {
        report(text, path, type, babelType)
    }
}

function report(text, path, type, babelType) {
    const { node } = path;
    const location = `${path.hub.file.opts.filename}#${node.loc ? node.loc.start.line : '!!!'}#${node.loc ? node.loc.start.column : '!!!'}`;

    let zhText = text.replace(/"/g, '\\\"');
    zhText = type == 'jsx' ? zhText.trim() : zhText;

    const sourceText = `${zhText}#${type}#${location}`;
    let notExist = false;
    if (type == 'text' && !~textArr.indexOf(`${zhText}#text#${location}`) && !~textArr.indexOf(`${zhText}#jsx#${location}`)) {
        notExist = true;
    } else if (type == 'jsx' && !~textArr.indexOf(`${zhText}#jsx#${location}`)) {
        notExist = true;
    } else if (type == 'template' && !~textArr.indexOf(`${zhText}#template#${location}`)) {
        notExist = true;
    }

    if (notExist) {
        // 没有扫描过
        console.log(sourceText + '#' + babelType);

        textArr.push(sourceText);
        // 中文文案已存在
        if (zhCH.has(zhText)) {
            const data = zhCH.get(zhText);
            data.source.push({ type, location });
            zhCH.set(zhText, data);
        } else {
            // 中文文案不存在
            zhCH.set(zhText, {
                id: autoZhKey ? zhText : "",
                defaultMessage: zhText,
                source: [{
                    type,
                    location
                }]
            });
        }
    }
}

module.exports = {
    run,
};
