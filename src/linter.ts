import { DiagnosticCollection } from 'vscode';
import { Package } from './autoproj'
import { Diagnostic, DiagnosticSeverity, Disposable, Range, TextDocument } from 'vscode';
import * as context from './context';
import * as wrapper from './wrappers';
import { safeDump } from 'js-yaml';
import { join, extname } from 'path';
import { realpathSync, readdirSync, statSync, Stats } from 'fs';

const DEFAULT_CLANG_CONFIG = {
    Checks: "clang-diagnostic-*,clang-analyzer-*,*",
    WarningsAsErrors: "",
    HeaderFilterRegex: "",
    AnalyzeTemporaryDtors: false,
    FormatStyle: "{ BasedOnStyle: google, IndentWidth: 8 }",
    CheckOptions: [
        {
            key: "bugprone-argument-comment.StrictMode",
            value: "0"
        },
        {
            key: "bugprone-assert-side-effect.AssertMacros",
            value: "assert"
        },
        {
            key: "bugprone-assert-side-effect.CheckFunctionCalls",
            value: "0"
        },
        {
            key: "bugprone-dangling-handle.HandleClasses",
            value: "std::basic_string_view;std::experimental::basic_string_view"
        },
        {
            key: "bugprone-string-constructor.LargeLengthThreshold",
            value: "8388608"
        },
        {
            key: "bugprone-string-constructor.WarnOnLargeLength",
            value: "1"
        },
        {
            key: "cert-dcl59-cpp.HeaderFileExtensions",
            value: ",h,hh,hpp,hxx"
        },
        {
            key: "cert-err09-cpp.CheckThrowTemporaries",
            value: "1"
        },
        {
            key: "cert-err61-cpp.CheckThrowTemporaries",
            value: "1"
        },
        {
            key: "cert-oop11-cpp.IncludeStyle",
            value: "llvm"
        },
        {
            key: "cppcoreguidelines-no-malloc.Allocations",
            value: "::malloc;::calloc"
        },
        {
            key: "cppcoreguidelines-no-malloc.Deallocations",
            value: "::free"
        },
        {
            key: "cppcoreguidelines-no-malloc.Reallocations",
            value: "::realloc"
        },
        {
            key: "cppcoreguidelines-owning-memory.LegacyResourceConsumers",
            value: "::free;::realloc;::freopen;::fclose"
        },
        {
            key: "cppcoreguidelines-owning-memory.LegacyResourceProducers",
            value: "::malloc;::aligned_alloc;::realloc;::calloc;::fopen;::freopen;::tmpfile"
        },
        {
            key: "cppcoreguidelines-pro-bounds-constant-array-index.GslHeader",
            value: ""
        },
        {
            key: "cppcoreguidelines-pro-bounds-constant-array-index.IncludeStyle",
            value: "0"
        },
        {
            key: "cppcoreguidelines-pro-type-member-init.IgnoreArrays",
            value: "0"
        },
        {
            key: "cppcoreguidelines-special-member-functions.AllowMissingMoveFunctions",
            value: "0"
        },
        {
            key: "cppcoreguidelines-special-member-functions.AllowSoleDefaultDtor",
            value: "0"
        },
        {
            key: "google-build-namespaces.HeaderFileExtensions",
            value: ",h,hh,hpp,hxx"
        },
        {
            key: "google-global-names-in-headers.HeaderFileExtensions",
            value: ",h,hh,hpp,hxx"
        },
        {
            key: "google-readability-braces-around-statements.ShortStatementLines",
            value: "1"
        },
        {
            key: "google-readability-function-size.BranchThreshold",
            value: "4294967295"
        },
        {
            key: "google-readability-function-size.LineThreshold",
            value: "4294967295"
        },
        {
            key: "google-readability-function-size.NestingThreshold",
            value: "4294967295"
        },
        {
            key: "google-readability-function-size.ParameterThreshold",
            value: "4294967295"
        },
        {
            key: "google-readability-function-size.StatementThreshold",
            value: "800"
        },
        {
            key: "google-readability-namespace-comments.ShortNamespaceLines",
            value: "10"
        },
        {
            key: "google-readability-namespace-comments.SpacesBeforeComments",
            value: "2"
        },
        {
            key: "google-runtime-int.SignedTypePrefix",
            value: "int"
        },
        {
            key: "google-runtime-int.TypeSuffix",
            value: ""
        },
        {
            key: "google-runtime-int.UnsignedTypePrefix",
            value: "uint"
        },
        {
            key: "google-runtime-references.WhiteListTypes",
            value: ""
        },
        {
            key: "hicpp-braces-around-statements.ShortStatementLines",
            value: "0"
        },
        {
            key: "hicpp-function-size.BranchThreshold",
            value: "4294967295"
        },
        {
            key: "hicpp-function-size.LineThreshold",
            value: "4294967295"
        },
        {
            key: "hicpp-function-size.NestingThreshold",
            value: "4294967295"
        },
        {
            key: "hicpp-function-size.ParameterThreshold",
            value: "4294967295"
        },
        {
            key: "hicpp-function-size.StatementThreshold",
            value: "800"
        },
        {
            key: "hicpp-member-init.IgnoreArrays",
            value: "0"
        },
        {
            key: "hicpp-move-const-arg.CheckTriviallyCopyableMove",
            value: "1"
        },
        {
            key: "hicpp-named-parameter.IgnoreFailedSplit",
            value: "0"
        },
        {
            key: "hicpp-no-malloc.Allocations",
            value: "::malloc;::calloc"
        },
        {
            key: "hicpp-no-malloc.Deallocations",
            value: "::free"
        },
        {
            key: "hicpp-no-malloc.Reallocations",
            value: "::realloc"
        },
        {
            key: "hicpp-special-member-functions.AllowMissingMoveFunctions",
            value: "0"
        },
        {
            key: "hicpp-special-member-functions.AllowSoleDefaultDtor",
            value: "0"
        },
        {
            key: "hicpp-use-auto.RemoveStars",
            value: "0"
        },
        {
            key: "hicpp-use-emplace.ContainersWithPushBack",
            value: "::std::vector;::std::list;::std::deque"
        },
        {
            key: "hicpp-use-emplace.SmartPointers",
            value: "::std::shared_ptr;::std::unique_ptr;::std::auto_ptr;::std::weak_ptr"
        },
        {
            key: "hicpp-use-emplace.TupleMakeFunctions",
            value: "::std::make_pair;::std::make_tuple"
        },
        {
            key: "hicpp-use-emplace.TupleTypes",
            value: "::std::pair;::std::tuple"
        },
        {
            key: "hicpp-use-equals-default.IgnoreMacros",
            value: "1"
        },
        {
            key: "hicpp-use-noexcept.ReplacementString",
            value: ""
        },
        {
            key: "hicpp-use-noexcept.UseNoexceptFalse",
            value: "1"
        },
        {
            key: "hicpp-use-nullptr.NullMacros",
            value: ""
        },
        {
            key: "llvm-namespace-comment.ShortNamespaceLines",
            value: "1"
        },
        {
            key: "llvm-namespace-comment.SpacesBeforeComments",
            value: "1"
        },
        {
            key: "misc-definitions-in-headers.HeaderFileExtensions",
            value: ",h,hh,hpp,hxx"
        },
        {
            key: "misc-definitions-in-headers.UseHeaderFileExtension",
            value: "1"
        },
        {
            key: "misc-misplaced-widening-cast.CheckImplicitCasts",
            value: "0"
        },
        {
            key: "misc-sizeof-expression.WarnOnSizeOfCompareToConstant",
            value: "1"
        },
        {
            key: "misc-sizeof-expression.WarnOnSizeOfConstant",
            value: "1"
        },
        {
            key: "misc-sizeof-expression.WarnOnSizeOfThis",
            value: "1"
        },
        {
            key: "misc-suspicious-enum-usage.StrictMode",
            value: "0"
        },
        {
            key: "misc-suspicious-missing-comma.MaxConcatenatedTokens",
            value: "5"
        },
        {
            key: "misc-suspicious-missing-comma.RatioThreshold",
            value: "0.200000"
        },
        {
            key: "misc-suspicious-missing-comma.SizeThreshold",
            value: "5"
        },
        {
            key: "misc-suspicious-string-compare.StringCompareLikeFunctions",
            value: ""
        },
        {
            key: "misc-suspicious-string-compare.WarnOnImplicitComparison",
            value: "1"
        },
        {
            key: "misc-suspicious-string-compare.WarnOnLogicalNotComparison",
            value: "0"
        },
        {
            key: "misc-throw-by-value-catch-by-reference.CheckThrowTemporaries",
            value: "1"
        },
        {
            key: "modernize-loop-convert.MaxCopySize",
            value: "16"
        },
        {
            key: "modernize-loop-convert.MinConfidence",
            value: "reasonable"
        },
        {
            key: "modernize-loop-convert.NamingStyle",
            value: "CamelCase"
        },
        {
            key: "modernize-make-shared.IgnoreMacros",
            value: "1"
        },
        {
            key: "modernize-make-shared.IncludeStyle",
            value: "0"
        },
        {
            key: "modernize-make-shared.MakeSmartPtrFunction",
            value: "std::make_shared"
        },
        {
            key: "modernize-make-shared.MakeSmartPtrFunctionHeader",
            value: "memory"
        },
        {
            key: "modernize-make-unique.IgnoreMacros",
            value: "1"
        },
        {
            key: "modernize-make-unique.IncludeStyle",
            value: "0"
        },
        {
            key: "modernize-make-unique.MakeSmartPtrFunction",
            value: "std::make_unique"
        },
        {
            key: "modernize-make-unique.MakeSmartPtrFunctionHeader",
            value: "memory"
        },
        {
            key: "modernize-pass-by-value.IncludeStyle",
            value: "llvm"
        },
        {
            key: "modernize-pass-by-value.ValuesOnly",
            value: "0"
        },
        {
            key: "modernize-raw-string-literal.ReplaceShorterLiterals",
            value: "0"
        },
        {
            key: "modernize-replace-auto-ptr.IncludeStyle",
            value: "llvm"
        },
        {
            key: "modernize-replace-random-shuffle.IncludeStyle",
            value: "llvm"
        },
        {
            key: "modernize-use-auto.RemoveStars",
            value: "0"
        },
        {
            key: "modernize-use-default-member-init.IgnoreMacros",
            value: "1"
        },
        {
            key: "modernize-use-default-member-init.UseAssignment",
            value: "0"
        },
        {
            key: "modernize-use-emplace.ContainersWithPushBack",
            value: "::std::vector;::std::list;::std::deque"
        },
        {
            key: "modernize-use-emplace.SmartPointers",
            value: "::std::shared_ptr;::std::unique_ptr;::std::auto_ptr;::std::weak_ptr"
        },
        {
            key: "modernize-use-emplace.TupleMakeFunctions",
            value: "::std::make_pair;::std::make_tuple"
        },
        {
            key: "modernize-use-emplace.TupleTypes",
            value: "::std::pair;::std::tuple"
        },
        {
            key: "modernize-use-equals-default.IgnoreMacros",
            value: "1"
        },
        {
            key: "modernize-use-noexcept.ReplacementString",
            value: ""
        },
        {
            key: "modernize-use-noexcept.UseNoexceptFalse",
            value: "1"
        },
        {
            key: "modernize-use-nullptr.NullMacros",
            value: "NULL"
        },
        {
            key: "modernize-use-transparent-functors.SafeMode",
            value: "0"
        },
        {
            key: "modernize-use-using.IgnoreMacros",
            value: "1"
        },
        {
            key: "objc-forbidden-subclassing.ForbiddenSuperClassNames",
            value: "ABNewPersonViewController;ABPeoplePickerNavigationController;ABPersonViewController;ABUnknownPersonViewController;NSHashTable;NSMapTable;NSPointerArray;NSPointerFunctions;NSTimer;UIActionSheet;UIAlertView;UIImagePickerController;UITextInputMode;UIWebView"
        },
        {
            key: "objc-property-declaration.Acronyms",
            value: "ASCII;PDF;XML;HTML;URL;RTF;HTTP;TIFF;JPG;PNG;GIF;LZW;ROM;RGB;CMYK;MIDI;FTP"
        },
        {
            key: "performance-faster-string-find.StringLikeClasses",
            value: "std::basic_string"
        },
        {
            key: "performance-for-range-copy.WarnOnAllAutoCopies",
            value: "0"
        },
        {
            key: "performance-inefficient-string-concatenation.StrictMode",
            value: "0"
        },
        {
            key: "performance-inefficient-vector-operation.VectorLikeClasses",
            value: "::std::vector"
        },
        {
            key: "performance-move-const-arg.CheckTriviallyCopyableMove",
            value: "1"
        },
        {
            key: "performance-move-constructor-init.IncludeStyle",
            value: "llvm"
        },
        {
            key: "performance-type-promotion-in-math-fn.IncludeStyle",
            value: "llvm"
        },
        {
            key: "performance-unnecessary-value-param.IncludeStyle",
            value: "llvm"
        },
        {
            key: "readability-braces-around-statements.ShortStatementLines",
            value: "0"
        },
        {
            key: "readability-function-size.BranchThreshold",
            value: "4294967295"
        },
        {
            key: "readability-function-size.LineThreshold",
            value: "4294967295"
        },
        {
            key: "readability-function-size.NestingThreshold",
            value: "4294967295"
        },
        {
            key: "readability-function-size.ParameterThreshold",
            value: "4294967295"
        },
        {
            key: "readability-function-size.StatementThreshold",
            value: "800"
        },
        {
            key: "readability-identifier-naming.IgnoreFailedSplit",
            value: "0"
        },
        {
            key: "readability-implicit-bool-conversion.AllowIntegerConditions",
            value: "0"
        },
        {
            key: "readability-implicit-bool-conversion.AllowPointerConditions",
            value: "0"
        },
        {
            key: "readability-simplify-boolean-expr.ChainedConditionalAssignment",
            value: "0"
        },
        {
            key: "readability-simplify-boolean-expr.ChainedConditionalReturn",
            value: "0"
        },
        {
            key: "readability-static-accessed-through-instance.NameSpecifierNestingThreshold",
            value: "3"
        }
    ]
};

export class Linter implements Disposable {
    private _timer: NodeJS.Timer;
    constructor(private _context: context.Context,
                private _wrapper: wrapper.VSCode,
                private _diagnosticCollection: DiagnosticCollection) {
    }

    public start(): void {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.lintDocument(), 1000);
    }

    public async lintDocument(): Promise<DiagnosticCollection | undefined> {
        let diagnostics: DiagnosticCollection | undefined;
        if (this._wrapper.activeTextEditor) {
            let document = this._wrapper.activeTextEditor.document
            if (this.isSupportedLanguage(document.languageId) &&
                this.isPartOfWorkspace(document.fileName)) {
                try {
                    const result = await this.runLinter(document.fileName);
                    diagnostics = this.parseResults(result, document.fileName);
                } catch (err) {
                    this._wrapper.showErrorMessage(err.message);
                }
            }
        }
        return diagnostics;
    }

    public dispose(): void {
        clearTimeout(this._timer);
    }

    private isPartOfWorkspace(fileName: string): boolean {
        let ws = this._wrapper.getWorkspaceFolder(fileName);
        return ws ? (this._context.getWorkspaceByPath(ws.uri.fsPath) != undefined) : false;
    }

    private isSupportedLanguage(language: string): boolean {
        const supportedLanguages = ["c", "cpp"];
        return (supportedLanguages.indexOf(language) >= 0);
    }

    private async package(fileName: string): Promise<Package | undefined> {
        let ws = this._wrapper.getWorkspaceFolder(fileName);
        let autoprojWs = this._context.getWorkspaceByPath(ws!.uri.fsPath);
        return (await autoprojWs!.info()).findPackage(ws!.uri.fsPath);
    }

    private async buildDir(fileName: string): Promise<string> {
        return (await this.package(fileName))!.builddir;
    }

    private async srcDir(fileName: string): Promise<string> {
        return (await this.package(fileName))!.srcdir;
    }

    private async lintConfiguration(pkgPath: string, fileName: string): Promise<string> {
        // TODO: load configuration from a file specified either in
        //       an extension setting or in an environment variable
        //       for easy overriding in autoproj buildconfs/package sets
        let config = Object.assign(DEFAULT_CLANG_CONFIG);
        config.HeaderFilterRegex = `${await this.buildDir(fileName)}|${pkgPath}`;

        return safeDump(config);
    }

    private isHeaderFile(fileName: string): boolean {
        const headerExtensions = [".h", ".hpp", ".hxx", ".hh"];
        return (headerExtensions.indexOf(extname(fileName)) >= 0);
    }

    private isSourceFile(fileName: string): boolean {
        const sourceExtensions = ['.cpp', '.cc', '.c', '.cxx'];
        return (sourceExtensions.indexOf(extname(fileName)) >= 0);
    }

    // Hack: since headers don't show up in compilation databases,
    // we lint all translatation units next to the header we actually
    // want to lint and hopefully one of them will include the header.
    private async filesToLint(fileName: string): Promise<Array<string>> {
        if (!this.isHeaderFile(fileName)) {
            return [fileName];
        }
        return this.listSources(await this.srcDir(fileName));
    }

    private listSources(path: string): Array<string> {
        let sourceFiles: string[] = [];
        const EXCLUDED_DIRS = [/^\./];

        // TODO: abort if 'path' is the build tree
        const files = readdirSync(path);
        for (let file of files) {
            const fullPath = join(path, file);
            let stat: Stats;
            try {
                stat = statSync(fullPath);
            }
            catch (e) {
                continue; // ignore files that can't be stat'ed (i.e broken symlinks)
            }
            if (stat.isDirectory()) {
                if (!EXCLUDED_DIRS.some(filter => filter.test(file))) {
                    sourceFiles = sourceFiles.concat(this.listSources(fullPath));
                }
            } else if (stat.isFile()) {
                if (this.isSourceFile(file)) {
                    sourceFiles.push(fullPath);
                }
            }
        }
        return sourceFiles;
    }

    private async runLinter(fileName: string): Promise<string> {
        let ws = this._wrapper.getWorkspaceFolder(fileName);
        let autoprojWs = this._context.getWorkspaceByPath(ws!.uri.fsPath);
        let autoprojProcess = autoprojWs!.autoprojExec(
            'clang-tidy',
            [
                '-p',
                await this.buildDir(fileName),
                `-config=${await this.lintConfiguration(ws!.uri.fsPath, fileName)}`,
                ...await this.filesToLint(fileName),
            ]
        );
        let output = '';

        autoprojProcess.stdout.on('data', (buffer) => output = output.concat(buffer.toString()))
        return new Promise<string>((resolve, reject) => {
            autoprojProcess.on('exit', (code, signal) => {
                if (code !== 0) {
                    reject(new Error(`Unable to run linter`))
                }
                else {
                    resolve(output.trim());
                }
            })
        })
    }

    private parseResults(result: string, targetFileName: string): DiagnosticCollection {
        this._diagnosticCollection.clear();

        // 1 = path, 2 = line, 3 = columns, 4 = message
        let regex = /^(.*):([0-9]+):([0-9]+):\s*(.*)/gm;
        let regexArray: RegExpExecArray | null;
        let fileData: { [key: string]: RegExpExecArray[] } = {};
        while (regexArray = regex.exec(result)) {
            if (regexArray[1] === undefined || regexArray[2] === undefined
                || regexArray[4] === undefined) {
                continue;
            }

            let fileName = realpathSync(regexArray[1]);
            if (fileName != realpathSync(targetFileName)) {
                continue;
            }
            if (!(fileName in fileData)) {
                fileData[fileName] = [];
            }
            fileData[fileName].push(regexArray);
        }

        for (let fileName in fileData) {
            this._wrapper.openTextDocument(fileName).then((doc: TextDocument) => {
                let diagnostics: Diagnostic[] = [];
                for (let index = 0; index < fileData[fileName].length; index++) {
                    let array = fileData[fileName][index];
                    let line = Number(array[2]);
                    let message = array[4];
                    if (line > 0) {
                        line--;
                    }

                    let l = doc.lineAt(line);
                    let r = new Range(line, 0, line, l.text.length);
                    let d = new Diagnostic(r, message, DiagnosticSeverity.Information);
                    d.source = 'lint';
                    diagnostics.push(d);
                }
                this._diagnosticCollection.set(doc.uri, diagnostics);
            });
        }
        return this._diagnosticCollection;
    }
}
