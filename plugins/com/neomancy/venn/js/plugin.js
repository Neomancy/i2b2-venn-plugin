window.addEventListener("I2B2_READY", ()=> { //anything we need initialized on plugin active
    // the i2b2 framework is loaded and ready (including population of i2b2.model namespace)

    //trigger separate render function that displays the list
    if (i2b2.model.renderData === undefined) i2b2.model.renderData = [];
    if (i2b2.model.dataset === undefined) i2b2.model.dataset = {};
    if (i2b2.model.metadata === undefined) i2b2.model.metadata = {};

    VennPlugin = (function(window, document, i2b2) {

        let app = {};

        let chart = venn.VennDiagram()
            .width(600)
            .height(600);
        app.chart = chart;

        let div = d3.select("#venn")
        div.datum(i2b2.model.renderData).call(chart);
        app.div = div;


        app.DropHandler = function(sdx) {
            if (sdx.sdxUnderlyingPackage !== undefined) sdx = sdx.sdxUnderlyingPackage;
            i2b2.model.metadata[sdx.sdxInfo.sdxKeyValue] = sdx;
            addPRS(sdx.sdxInfo.sdxKeyValue);
        };

        let addPRS = function(prsId) {
            i2b2.ajax.CRC.getPDO_fromInputList({
                patient_limit: 0,
                PDO_Request: `
                    <input_list>
                        <patient_list max="5000000" min="0">
                            <patient_set_coll_id>${prsId}</patient_set_coll_id>
                        </patient_list>
                    </input_list>
                    <filter_list/>
                    <output_option><patient_set select="using_input_list" onlykeys="true"/></output_option>`
            }).then((data) => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(data, "text/xml");
                let patientRecords = doc.getElementsByTagName("patient_id");
                for (let i = 0;i < patientRecords.length; i++) {
                    const id = patientRecords[i].textContent;
                    if (i2b2.model.dataset[id] === undefined) i2b2.model.dataset[id] = new Set();
                    i2b2.model.dataset[id].add(prsId);
                }
                i2b2.state.save();
                app.recalc();
                emphasizeSet(prsId);
            });
        };
        app.addPRS = addPRS;

        let removePRS = function(prsId) {
            if (i2b2.model.metadata[prsId] !== undefined) {
                delete i2b2.model.metadata[prsId];
                for (let patientId in i2b2.model.dataset) {
                    i2b2.model.dataset[patientId].delete(prsId);
                    if (i2b2.model.dataset[patientId].size === 0) delete i2b2.model.dataset[patientId];
                }
                app.recalc();
                // redraw
                div.datum(i2b2.model.renderData).call(chart);
                attachMouse();
            }
        };
        app.removePRS = removePRS;

        app.recalc = function() {
            i2b2.model.renderData = [];

            // build combinatorial listing for counts
            let setIds = Object.keys(i2b2.model.metadata);
            let funcComboBuilder = function(sets) {
                let results = [];
                let f = function(prefix, remaining) {
                    for (let i=0; i<remaining.length; i++) {
                        let newPrefix = prefix.concat([remaining[i]]);
                        results.push(newPrefix);
                        f(newPrefix, remaining.slice(i + 1));
                    }
                }
                f([], sets);
                return results;
            };
            let allCombos = funcComboBuilder(setIds);
            i2b2.model.renderData = allCombos.map((d) => {
                let ret = {sets: d, size: 0};
                if (d.length === 1) {
                    let label;
                    if (i2b2.model.metadata[d[0]].renderData) {
                        label = i2b2.model.metadata[d[0]].renderData.title.replace("Patient Set for ","").replaceAll('"','');
                    } else {
                        label = i2b2.model.metadata[d[0]].origData.title.replace("Patient Set for ","").replaceAll('"','').replace('- FINISHED','');
                    }
                    ret.label = label.split("@")[0].trim();
                }
                return ret;
            });

            let rd = i2b2.model.renderData;
            for (let patientId in i2b2.model.dataset) {
                for (let idx=0; idx<rd.length; idx++) {
                    let shouldCount = true;
                    for (let targetSet of rd[idx].sets) {
                        if (!i2b2.model.dataset[patientId].has(targetSet)) {
                            shouldCount = false;
                            break;
                        }
                    }
                    if (shouldCount) rd[idx].size++;
                }
            }

            // save calculated data
            i2b2.state.save();

            // display list of PRS
            let listDiv = document.querySelector("#prsList");
            listDiv.innerHTML = "";
            let titles = i2b2.model.renderData.filter((d) => d.sets.length === 1 ).map((d) => { return {label: d.label, id: d.sets[0]} });
            for (let temp of titles) {
                temp.origTitle = i2b2.model.metadata[temp.id].origData.title
                let entry = listDiv.appendChild(document.createElement("div"));
                entry.textContent = temp.label;
                entry.title = temp.origTitle;
                entry.dataset["id"] = temp.id;
            }
            if (titles.length > 0) {
                document.querySelector(".prsListArea").style.display = "block";
                // attach click handlers
                document.querySelectorAll("#prsList > div").forEach((d) => {
                    d.addEventListener("click", (evt) => {
                        removePRS(evt.target.dataset["id"]);
                    })
                });
            } else {
                document.querySelector(".prsListArea").style.display = "";
            }

        };

        let emphasizeSet = function(setId) {
            if (i2b2.model.metadata[setId] === undefined) return;
            i2b2.model.currentEmphasis = setId;
            // remove old weights
            i2b2.model.renderData.forEach((d) => { if (d.sets.length > 1) d.weight = 1e-10; });
            // add weights
            i2b2.model.renderData.forEach((d) => {
                if (d.sets.includes(setId) || d.size === 0) d.weight = 1;
            });
            i2b2.state.save();
            // redraw
            div.datum(i2b2.model.renderData).call(chart);
            attachMouse();
            // highlight
            let temp = document.querySelector('.venn-circle.selected');
            if (temp) temp.classList.remove("selected");
            document.querySelector('*[data-venn-sets="'+setId+'"]').classList.add("selected");
        }

        let attachMouse = function() {
            div.selectAll("g")
                .on("click", function(d, i) {
                    // sort all the areas relative to the current item
                    if (d.sets.length === 1) {
                        // single space is selected
                        emphasizeSet(d.sets[0]);
                    } else if (d.sets.length === 2) {
                        // overlap is selected
                        let targets = i2b2.model.renderData.filter((i) => (i.sets.length === 1 && (i.sets.includes(d.sets[0]) || i.sets.includes(d.sets[1]))) );
                        targets.sort((a,b) => {
                            if (b.size > a.size) {
                                return -1;
                            } else if (b.size < a.size) {
                                return 1;
                            } else {
                                return 0;
                            }
                        });
                        if (targets.length > 0) emphasizeSet(targets[0].sets[0]);
                    }
                })


                .on("mouseover", function(d, i) {
                    // sort all the areas relative to the current item
                    venn.sortAreas(div, d);

                    // Display a tooltip with the current size
                    tooltip.transition().duration(400).style("opacity", .9);
                    let parents = i2b2.model.renderData.filter((i) => (i.sets.length === 1 && d.sets.includes(i.sets[0])));
                    let labelParents = parents.map(d=>"<span>"+d.label+"</span>").join(" &cup; ");
                    tooltip.html(labelParents + "<br>" + d.size.toLocaleString() + " patients");

                    // highlight the current path
                    var selection = d3.select(this).transition("tooltip").duration(400);
                    selection.select("path")
                        .style("fill-opacity", d.sets.length === 1 ? .4 : .1)
                        .style("stroke-opacity", 1);
                })

                .on("mousemove", function() {
                    tooltip.style("left", (d3.event.pageX) + "px")
                        .style("top", (d3.event.pageY + 32) + "px");
                })

                .on("mouseout", function(d, i) {
                    tooltip.transition().duration(400).style("opacity", 0);
                    var selection = d3.select(this).transition("tooltip").duration(400);
                    selection.select("path")
                        .style("fill-opacity", d.sets.length === 1 ? .25 : .0)
                        .style("stroke-opacity", 0);
                });
        };

        app.tooltip = d3.select("body").append("div")
            .attr("class", "venntooltip");

        div.selectAll("path")
            .style("stroke-opacity", 0)
            .style("stroke", "#fff")
            .style("stroke-width", 3)

        attachMouse();

        return app;
    })(window, document, i2b2);



    // TODO: display the graphs if they have already been processed


    // drop event handlers used by this plugin
    i2b2.sdx.AttachType(document.body, "PRS");
    i2b2.sdx.setHandlerCustom(document.body, "PRS", "DropHandler", VennPlugin.DropHandler);

});


