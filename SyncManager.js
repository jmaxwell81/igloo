/*
 * Provide methods contributing to the synchronization process.
 * Uploading, Doenloading files and comparing with servicenow instance
 * 
 * Author : Harsh Sodiwala
 */

const vscode = require('vscode');
const path = require("path");

const constants = require("./constants");
const HttpClient = require("./HttpClient");
const FileSystemManager = require("./FileSystemManager");
const Utils = require('./Utils');

var global_register = {}

class SyncManager {
    constructor() {
        this.fs_manager = new FileSystemManager.FileSystemManager();
        this.fs_manager._initiateConfigFile();
        this.utils = new Utils.Utils();

        this._loadConfig()
        this.fs_manager = new FileSystemManager.FileSystemManager();
    }

    /*
     * Initiate required objects which are based on the configurations
     */
    _loadConfig() {
        this.config = this._readConfig();
        this.http_client = new HttpClient.HttpClient(
            this.config.url,
            this.config.username,
            this.config.password
        );
        this.app_name = this.config.app_name;
    }

    /*
     * Read the config file and return as JSON
     * Return JSON with empty values if configuration is not done yet
     */
    _readConfig() {
        const config_path = this.utils.getConfigPath();
        const config_content = this.fs_manager.readFile(config_path);
        if(config_content == "") {
            vscode.window.showWarningMessage("Please enter details in config file before starting to operate.");
            return {
                "url" : "https://<instance>.service-now.com/",
                "username" : "",
                "password" : "",
                "app_name" : ""
            }
        }
        const config = JSON.parse(config_content);
        return config;
    }

    _updateRegister(file_object) {
        //Read register
        //Figure out type of file
        //Make entry under relevant object in dict
        //Update sys_id, name, sys_class, update_time
    }

    /*
     * Read the register file and return as JSON
     */
    _readRegister() {
        const register_path = this.utils.getRegisterPath();
        var register_content = this.fs_manager.readFile(register_path);
        return register_content;
    }

    /*
     * Load the global register variable
     * Global register exist to prevent the async write operations from overwriting content
     */
    _loadGlobalRegister() {
        const root_path = this.utils.getRootPath();
        const register_path = path.join(root_path, constants.outdir, "register.json");
        var register_content_string = this._readRegister();
        register_content_string = register_content_string  ? register_content_string : "{}";
        var register_content = JSON.parse(register_content_string);
        global_register = register_content;
    }

    /*
     * @file_type : the type of file to download. Eg. sys_ui_action 
     * 
     * Download the files of the given type and save in respective directory 
     */
    async _downloadSingleTypeOfFile(file_type) {
        console.log("Collecting " + file_type + " files");
        global_register = {};
        this._loadGlobalRegister();
        var table_name = file_type;
        var query_params = {
            "sysparm_query" : "sys_scope.name="+ this.app_name
        };
        
        var success = true;
        var all_files_response = await this.http_client.get(table_name, query_params=query_params).then(
            response=>{
                console.log("Success in donwloading all files : " + table_name);
                return response.body;
            }, 
            error=>{
                success = false;
                vscode.window.showErrorMessage("Error while downloading " + table_name);
                return error;
            })
        
        if(!success) {
            console.log("Failed to download " + file_type);
            return;
        }
    
        var result = all_files_response.result
        var file_list_length = result.length;

        const root_path = this.utils.getRootPath();
        const register_path = this.utils.getRegisterPath();

        for(var i=0; i<file_list_length; i++) {
            
            if(global_register[file_type] && global_register[file_type][result[i].name]) {
                console.log("File already present");
                continue;
            }
            
            const file_path = path.join(
                root_path, 
                constants.outdir, 
                constants.TYPE_DIRECTORY_MAP[result[i].sys_class_name],
                result[i].sys_name + ".js"
            )
            
            this.fs_manager.writeFile(file_path, result[i].script);
            
            if(!global_register[file_type]) {
                global_register[file_type] = {}
            }

            global_register[file_type][result[i].sys_name] = {
                "name" : result[i].sys_name,
                "sys_created_on" : result[i].sys_created_on,
                "sys_updated_on" : result[i].sys_updated_on,
                "sys_class_name" : result[i].sys_class_name,
                "sys_id" : result[i].sys_id
            }            
            this.fs_manager.writeFile(register_path, JSON.stringify(global_register, null, 4))            
        }
        console.log("Collected " + file_type + " files");
    }

    /*
     * Crete the required directory structure.
     * Re-create the entities that are missing
     * Write the empty register file if not already present
     */
    createAndMaintainStructure() {
        console.log("Creating structure.");
        this._loadConfig();
        const root_path = this.utils.getRootPath();

        //get outdir path
        const outpath = path.join(root_path, constants.outdir);
        
        //create outdir
        this.fs_manager.makeDir(outpath);

        //create sub-directories
        const file_types = constants.FILE_TYPES;
        var dir_list_len = file_types.length;
        for(var dir_index=0; dir_index < dir_list_len; dir_index++) {
            this.fs_manager.makeDir(path.join(outpath, constants.TYPE_DIRECTORY_MAP[file_types[dir_index]]));
        }

        //create register file
        this.fs_manager._createRegisterFile(outpath);
    
    }

    /*
     * Call the download_single_type for each file_type mentioned in the constants file
     */
    async downloadAll() {
        console.log("Downloading all files from SNOW.");
        this.createAndMaintainStructure();
        this._loadConfig();
        var prom_list = [];
        for(var f_index=0, f_list_length = constants.FILE_TYPES.length; f_index < f_list_length; f_index++) {
            var y = this._downloadSingleTypeOfFile(constants.FILE_TYPES[f_index]);
            prom_list.push(y);
        }

        Promise.all(prom_list).then(function(values) {
            console.log("Downloaded all files.");
            vscode.window.showInformationMessage("Downloaded all files");
        });
    }

    /*
     * Compare the current file wth its counterpart on SNOW instance
     * Give user option to select type of comparision : Local->Remote or Remote->Local
     */
    async showDiff() {
        console.log("Diffing");
     
        var selection = ""
        await vscode.window.showQuickPick(['Remote ↔ Local', 'Local ↔ Remote']).then(
            res => {
                selection = res ? res : "undefined";
                return res;
            },
            err => {
                selection = "undefined"
                return "undefined"
            }
        );
        
        if(selection == "undefined") {
            vscode.window.showErrorMessage("Could not display diff");
            return
        }
    
        const current_file_name = this.utils.getFileName().replace("\.js", "");
        const dir = this.utils.getDirName();
        const file_type = this.utils.getFileTypeByDir(dir);

        console.log("Fetching " + current_file_name + " : " + file_type);
        
        const register_str = this._readRegister()
        const register = JSON.parse(register_str);

        var table_name = file_type;

        console.log("Looking for " + current_file_name + " in " + table_name);
        
        this.downloadSingleFile(current_file_name, table_name).then(
            result=>{
                const resp = result.body;
                if(resp.result.length) {
                    var res = resp.result[0].script;
                    vscode.workspace.openTextDocument({
                        content : res, 
                        language : "javascript"
                    }).then(doc => {
                        console.log("Showing diff");
                        
                        var title = "Remote ↔ Local"
                        var leftUri = doc.uri;
                        var rightUri = vscode.window.activeTextEditor.document.uri
                        if(selection == "Local ↔ Remote") {
                            var title = "Local ↔ Remote"
                            var leftUri = vscode.window.activeTextEditor.document.uri;
                            var rightUri = doc.uri;
                        }
                        
                        vscode.commands.executeCommand(
                            'vscode.diff', 
                            leftUri,
                            rightUri, 
                        this.utils.getFileName().replace("\.js", "") + ' ' + title);
                    })//vscode.window.showTextDocument(doc))
                }
                else {
                    vscode.window.showErrorMessage("Could not find " + current_file_name);
                }
            },
            err=>{
                console.log("Err");
                console.log(err);
                vscode.window.showErrorMessage("Error while fetching " + current_file_name);
            }
        );
    }

    /*
     * @current_file_name
     * Download the given file from the given table on SNOW
     * Retuen a promise that resolves to the file contents
     */
    downloadSingleFile(file_name, table_name) {
        var query_params = {
            "sysparm_query" : "name="+ file_name + "^sys_scope.name=" + this.app_name
        };
        return this.http_client.get(table_name, query_params=query_params);
    }

    /*
     * Upload the given file to the given table on SNOW
     */
    async uploadFile(script) {
        console.log("Uploading " + this.utils.getFileName());
        var register = this._readRegister()
        register = JSON.parse(register);
        
        const file_type = this.utils.getFileTypeByDir(this.utils.getDirName());
        const file_name = this.utils.getFileName().replace("\.js", "");
        const table = file_type;
        const sys_id = register[file_type][file_name]['sys_id'];
        console.log("Attempting put");
        this.http_client.put(table, sys_id, script).then(result=>{
            var local_update_time = register[file_type][file_name]['sys_updated_on'];
            var result_obj = JSON.parse(result.text);
            
            
            var remote_update_ime = result_obj['result']['sys_updated_on'];
            register[file_type][file_name]['sys_updated_on'] = remote_update_ime;
            const register_path = this.utils.getRegisterPath();
            this.fs_manager.writeFile(register_path, JSON.stringify(register, null, 4))
            vscode.window.showInformationMessage("Uploaded " + file_name);
            console.log(remote_update_ime);
        }, err=>{
            vscode.window.showErrorMessage("Failed to upload " + file_name);
            console.log("Failed to upload " + file_name);
            console.log(err);
        })
    }

    async showExternalScript(external_file_name) {
        const current_file_name = this.utils.getFileName().replace("\.js", "");
        const dir = this.utils.getDirName();
        const file_type = this.utils.getFileTypeByDir(dir);

        console.log("Fetching " + external_file_name + " : " + current_file_name + " : " + file_type);
        
        const register_str = this._readRegister()
        const register = JSON.parse(register_str);

        if(register[file_type] && register[file_type][current_file_name])
            var table_name = file_type;
        else {
            console.log("Unknown file");
            var current_file_header_str = vscode.window.activeTextEditor.document.lineAt(1).text;
            var current_file_header = JSON.parse(current_file_header_str);
            table_name = current_file_header['table'];
        }

        table_name = table_name=="ecc_agent_script_include" ? table_name : "sys_script_include";

        if(register[table_name] && register[table_name][external_file_name]) {
            console.log("External file already present");
            var file_path = path.join(
                this.utils.getRootPath(),
                constants.outdir,
                constants.TYPE_DIRECTORY_MAP[table_name],
                external_file_name+".js"
            )
            
            var uri = vscode.Uri.file(file_path);  
            vscode.window.showTextDocument(uri);
            return;
        }

        console.log("Looking for " + external_file_name + " in " + table_name);
        
        this.downloadSingleFile(external_file_name, table_name).then(
            result=>{
                const resp = result.body;
                if(resp.result.length) {
                    var res = resp.result[0].script;
                    res  = '/*\n{"table" : '+ '"'+ table_name +'"}\n*/\n' + res;
                    vscode.workspace.openTextDocument({
                        content : res, 
                        language : "javascript"
                    }).then(doc => vscode.window.showTextDocument(doc))
                }
                else {
                    vscode.window.showErrorMessage("Could not find " + external_file_name);
                }
            },
            err=>{
                console.log("Err");
                console.log(err);
                vscode.window.showErrorMessage("Error while fetching " + external_file_name);
            }
        );

    }
}
exports.SyncManager = SyncManager;