function showErrorAlertModal(error) {
    // Invoke the asynchronous alert box
    Xrm.Navigation.openAlertDialog({ 
        title: "Error", 
        text: "Something went wrong: " + error, 
        confirmButtonLabel: "Close" 
    }, { 
        height: 220, 
        width: 450 
    }).then(
        function (success) { console.log("Alert closed by the user."); },
        function (error) { console.log("Error displaying alert: " + error.message); }
    );
}

function showConfirmationModal(executionContext) {
    Xrm.Navigation.openConfirmDialog({
        title: "Confirm Client",
        subtitle: "Optional subtitle",
        text: "Are you sure you want to proceed with this action?",
        confirmButtonLabel: "Yes",
        cancelButtonLabel: "No"
    }, { 
        height: 200, 
        width: 450 
    }).then(
        function (success) {
            if (success.confirmed) {
                // Add code here to run if user clicks "Yes"
                console.log("User clicked OK/Confirm.");
            } else {
                // Add code here to run if user clicks "No"
                console.log("User clicked Cancel.");
            }
        },
        function (error) { console.log("Error: " + error.message); }
    );
}

function promptForJSONdata(primaryControl) {
    var jsonInput = prompt("Paste in the JSON data below");
    if (!jsonInput || jsonInput.trim() == "") {
        return;
    }

    try {
        var pciFormData = JSON.parse(jsonInput);

        //pciFormData.preferredname;
        //pciFormData.dateofbirth;

        Xrm.Navigation.openConfirmDialog({
            title: "Confirm Client",
            subtitle: pciFormData.preferredname + ' - ' + pciFormData.dateofbirth,
            text: "Is this the correct client?",
            confirmButtonLabel: "Yes",
            cancelButtonLabel: "No"
        }, { 
            height: 200, 
            width: 450 
        }).then(
            function (success) {
                if (success.confirmed) {
                    Xrm.Page.getAttribute("rsmhhs_agecategory").setValue(pciFormData.agecategory);

                    setTimeout (() => {
                        if (pciFormData.agecategory == 592570001) { // if "Adult"
                            Xrm.Page.getAttribute("rsmhhs_agecategory").setValue(pciFormData.familyguardian_perspective_needed);
                        }
                    
                        setTimeout(() => {
                            if (pciFormData.dateofassessment) {
                                Xrm.Page.getAttribute("rsmhhs_dateofassessment").setValue(new Date(pciFormData.dateofassessment));
                            }

                            for (key in pciFormData) {
                                if (
                                    key != "agecategory" &&
                                    key != "familyguardian_perspective_needed" &&
                                    key != "preferredname" &&
                                    key != "dateofbirth" && 
                                    key != "dateofassessment" &&
                                    key.indexOf('system_info') == -1  // make sure it's not system info
                                ) {
                                    if (pciFormData[key]) {
                                        Xrm.Page.getAttribute("rsmhhs_" + key).setValue(pciFormData[key]);
                                    }
                                }
                            }

                            // Invoke an alert box
                            let confirmFinalText = "Please complete the following sections manually, then save:\nContributors\nRecord Administration"; 
                            if (pciFormData.system_info) {
                                confirmFinalText += '\n\n' + pciFormData.system_info;
                            }

                            Xrm.Navigation.openAlertDialog({ 
                                title: "Next steps", 
                                text: confirmFinalText, 
                                confirmButtonLabel: "OK"
                            }, { 
                                height: confirmFinalText.split('\n').length * 16 + 250, 
                                width: 450 
                            }).then(
                                function (success) { console.log("Alert closed by the user."); },
                                function (error) { console.log("Error displaying alert: " + error.message); }
                            );

                        }, 500);
                    }, 500);

                } else {
                    // Add code here to run if user clicks "No"
                    console.log("User clicked Cancel.");
                }
            },
            function (error) { showErrorAlertModal(error.message); }
        );

    } catch (error) {
        showErrorAlertModal(error.message);
    }
}
