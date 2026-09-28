function showErrorAlertModal(error) {
    Xrm.Navigation.openAlertDialog(
        {
            title: "Error",
            text: "Something went wrong: " + error,
            confirmButtonLabel: "Close",
        },
        { height: 220, width: 450 }
    );
}

function promptForJSONdata(primaryControl) {
    var jsonInput = prompt("Paste in the JSON data below");
    if (!jsonInput || jsonInput.trim() == "") {
        return;
    }

    try {
        var pciFormData = JSON.parse(jsonInput);

        Xrm.Navigation.openConfirmDialog(
            {
                title: "Confirm Client",
                subtitle: (pciFormData.preferredname || "Unknown") + " - " + (pciFormData.dateofbirth || "No DOB"),
                text: "Is this the correct client?",
                confirmButtonLabel: "Yes",
                cancelButtonLabel: "No",
            },
            { height: 200, width: 450 }
        ).then(
            function (success) {
                if (!success.confirmed) {
                    console.log("User clicked Cancel.");
                    return;
                }

                // 1. Focus the general tab
                Xrm.Page.ui.tabs.forEach((t) => {
                    if (t.getLabel() == "General") {
                        t.setVisible(true);
                        t.setDisplayState("expanded");
                        t.setFocus();
                    }
                });

                // Wrap inner async execution to safely catch downstream errors
                setTimeout(() => {
                    try {
                        let ageElem = Xrm.Page.getAttribute("rsmhhs_agecategory");
                        if (ageElem) {
                            ageElem.setValue(pciFormData.agecategory);
                            ageElem.fireOnChange();
                        }

                        setTimeout(() => {
                            try {
                                if (pciFormData.agecategory == 592570001) { // "Adult"
                                    // FIXED: Changed schema name mapping from agecategory to familyguardian parameter
                                    let perElem = Xrm.Page.getAttribute("rsmhhs_familyguardian_perspective_needed");
                                    if (perElem) {
                                        perElem.setValue(pciFormData.familyguardian_perspective_needed);
                                        perElem.fireOnChange();
                                    }
                                }

                                setTimeout(() => {
                                    try {
                                        if (pciFormData.dateofassessment) {
                                            let dateElem = Xrm.Page.getAttribute("rsmhhs_dateofassessment");
                                            if (dateElem) dateElem.setValue(new Date(pciFormData.dateofassessment));
                                        }

                                        for (let key in pciFormData) {
                                            if (
                                                key != "agecategory" &&
                                                key != "familyguardian_perspective_needed" &&
                                                key != "preferredname" &&
                                                key != "dateofbirth" &&
                                                key != "dateofassessment" &&
                                                key.indexOf("system_info") == -1
                                            ) {
                                                if (pciFormData[key]) {
                                                    let attributeName = "rsmhhs_" + key;
                                                    let formAttr = Xrm.Page.getAttribute(attributeName);
                                                    
                                                    if (formAttr) {
                                                        // FIXED: Use getControl() instead of getAttribute() for visibility logic
                                                        let formCtrl = Xrm.Page.getControl(attributeName);
                                                        if (formCtrl) {
                                                            formCtrl.setVisible(true);
                                                        }
                                                        formAttr.setValue(pciFormData[key]);
                                                    }
                                                }
                                            }
                                        }

                                        // Formulate final success notification alert modal windows
                                        let confirmFinalText = "Please complete the following sections manually, then save:\n• Contributors\n• Record Administration";
                                        if (pciFormData.system_info) {
                                            confirmFinalText += "\n\nDouble-check the following sections:" + ("\n" + pciFormData.system_info.trim()).replace(/\n/g, "\n• ");
                                        }

                                        Xrm.Navigation.openAlertDialog(
                                            {
                                                title: "Next steps",
                                                text: confirmFinalText,
                                                confirmButtonLabel: "OK",
                                            },
                                            {
                                                height: confirmFinalText.split("\n").length * 16 + 200,
                                                width: 450,
                                            }
                                        );

                                    } catch (e3) { showErrorAlertModal("Error populating fields: " + e3.message); }
                                }, 1500);

                            } catch (e2) { showErrorAlertModal("Error setting family/guardian perspective selection: " + e2.message); }
                        }, 750);

                    } catch (e1) { showErrorAlertModal("Error setting Adult/Youth selection: " + e1.message); }
                }, 500);
            },
            function (error) { showErrorAlertModal(error.message); }
        );
    } catch (error) {
        showErrorAlertModal(error.message);
    }
}