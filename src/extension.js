/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/* Olaf Leidinger <oleid@mescharet.de>  
   Thomas Liebetraut <thomas@tommie-lie.de>
*/

const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GnomeDesktop = imports.gi.GnomeDesktop;
const Lang = imports.lang;
const Mainloop = imports.mainloop; // timer
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Layout = imports.ui.layout;
const FileUtils = imports.misc.fileUtils;

const Main        = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PanelMenu   = imports.ui.panelMenu;
const PopupMenu   = imports.ui.popupMenu;
const Panel       = imports.ui.panel;


const Gettext        = imports.gettext;
const ExtensionUtils = imports.misc.extensionUtils;
const Me             = ExtensionUtils.getCurrentExtension();
const Utils          = Me.imports.utils;

Utils.initTranslations();

const _  = Gettext.gettext;
const N_ = function(e) { return e; };



const TeaTimeFullscreenNotification = new Lang.Class({
    Name: 'TeaTimeFullscreenNotification',
    
    _init: function() {
        // this spans the whole monitor and contains
        // the actual layout, which it displays in
        // the center of itself
        
        // TODO: trying to centre the tea cup... doesn't work
        this._bin = new St.Bin({ x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE});
        this._monitorConstraint = new Layout.MonitorConstraint();
        this._bin.add_constraint(this._monitorConstraint);
        Main.uiGroup.add_actor(this._bin);
        
        // a vertical box layout to hold the texture and
        // a label underneath it
        this._layout = new St.BoxLayout({ vertical: true });
        this._bin.set_child(this._layout);

        // find all the textures
        let datadir = Me.dir.get_child("data");
        this._textureFiles = [];
        if (datadir.query_exists(null)) {
            let enumerator = datadir.enumerate_children(Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                                                        Gio.FileQueryInfoFlags.NONE,
                                                        null);
            let info;
            info = enumerator.next_file(null);
            while ( info != null ) {
                let filename = info.get_name();
                if (filename.match(/^cup.*/)) {
                    this._textureFiles.push(datadir.get_child(filename).get_path());
                }
                info = enumerator.next_file(null);
            }
        }
        this._textureFiles.sort();

        this._texture = new Clutter.Texture({ reactive: true, keep_aspect_ratio: true });
        this._texture.connect("button-release-event", Lang.bind(this, this.hide));
        this._layout.add_child(this._texture);
        
        this._timeline = new Clutter.Timeline({ duration: 2000, repeat_count: -1, progress_mode: Clutter.AnimationMode.LINEAR });
        this._timeline.connect("new-frame", Lang.bind(this, this._newFrame));

        this._label = new St.Label({ text: _("Your tea is ready!"), style_class: "dash-label" });
        this._layout.add_child(this._label);

        this._lightbox = new imports.ui.lightbox.Lightbox(Main.uiGroup); // Seems not to work on Gnome 3.10 { fadeInTime: 0.5, fadeOutTime: 0.5 }
        this._lightbox.highlight(this._bin);
    },
    destroy: function() {
        this.hide();
        Main.popModal(this._bin);
        this._bin.destroy();
        this._lightbox.hide();
    },
    _newFrame: function(timeline, msecs, user) {
        let progress = timeline.get_progress();
        let idx = Math.round(progress * this._textureFiles.length) % this._textureFiles.length;
        this._texture.set_from_file(this._textureFiles[idx]);
    },
    show: function() {
        this._monitorConstraint.index = global.screen.get_current_monitor()
        Main.pushModal(this._bin);
        this._timeline.start();
        this._lightbox.show();
        this._bin.show_all();
    },
    hide: function() {
        Main.popModal(this._bin);
        this._bin.hide();
        this._lightbox.hide();
        this._timeline.stop();
    }
})


const PopupTeaMenuItem = new Lang.Class({
    Name: 'PopupTeaMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (sTeaname, nBrewtime, params) {
        this.parent(params);

        this.tealabel  = new St.Label({ text: sTeaname });
        this.timelabel = new St.Label({ text: Utils.formatTime(nBrewtime) });
        this.actor.add(this.tealabel,  { expand: true });
        this.actor.add(this.timelabel);
    }
});


const TeaTime = new Lang.Class({
    Name : 'TeaTime',
    Extends : PanelMenu.Button,

    _init : function() {
        this.parent(0.0, "TeaTime");

        this._settings = Utils.getSettings();

        this._logo = new St.Icon({
            icon_name : 'utilities-teatime',
            style_class : 'system-status-icon'
        });

        // set timer widget
        this._timer = new St.DrawingArea({
            reactive : true
        });
        this._timer.set_width(20);
        this._timer.set_height(20);
        this._timer.connect('repaint', Lang.bind(this, this._drawTimer));

        this.actor.add_actor(this._logo);

        this._dt = 1;
        this._idleTimeout = null;

        this._createMenu();
    },
    _createMenu : function() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._settings.connect("changed::" + Utils.TEATIME_STEEP_TIMES_KEY,
                               Lang.bind(this, this._updateTeaList));

        this.teaItemCont = new PopupMenu.PopupMenuSection();

        /*******************/
        let head         = new PopupMenu.PopupMenuSection();
        let settingsIcon = new St.Icon({ icon_name : 'gtk-preferences', icon_size: 15 });
		let item         = new PopupMenu.PopupMenuItem(_("Show settings"));

        item.actor.set_pack_start(true);  // pack the icon in front of the text label
        item.actor.add(settingsIcon);
		item.connect('activate', Lang.bind(this, this._showPreferences));
		head.addMenuItem(item);

        /*******************/
        let bottom = new PopupMenu.PopupMenuSection();
        this._customEntry = new St.Entry({ style_class: 'teatime-custom-entry',
                                         track_hover: true,
                                         hint_text: _("min:sec") });
        this._customEntry.get_clutter_text().set_max_length(10);
        this._customEntry.get_clutter_text().connect("key-press-event", Lang.bind(this, this._createCustomTimer));
        bottom.box.add(this._customEntry);
        bottom.actor.set_style("padding: 0px 18px;")

        /*******************/

        this.menu.addMenuItem(head);        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.teaItemCont);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(bottom);

        this._updateTeaList();
    },
    _updateTeaList : function(config, output) {
        // make sure the menu is empty
        this.teaItemCont.removeAll();
        
        // fill with new teas
        let list = this._settings.get_value(Utils.TEATIME_STEEP_TIMES_KEY).unpack();
        for (let teaname in list) {
            let time = list[teaname].get_uint32();
            
            let menuItem = new PopupTeaMenuItem(_(teaname), time);
            menuItem.connect('activate', Lang.bind(this, function() {
                this._initCountdown(time);
            }));
            this.teaItemCont.addMenuItem(menuItem);
        }
    },
    _createCustomTimer: function(text, event) {
        if (event.get_key_symbol() == Clutter.KEY_Enter ||
            event.get_key_symbol() == Clutter.KEY_Return) {

            let customTime = text.get_text();
            let seconds = 0;
            let match = customTime.match(/^(?:(\d+)(?::(\d{0,2}))?|:(\d+))$/)
            if (match) {
                if (match[3])
                    seconds = parseInt(match[3]);
                else {
                    if (match[1])
                        seconds += parseInt(match[1]) * 60;
                    if (match[2])
                        seconds += parseInt(match[2]);
                }
                this._initCountdown(seconds);
                this.menu.close();
            }
            this._customEntry.set_text("");
        }
    },
    _showNotification : function(subject, text) {
        let source = new MessageTray.Source(_("TeaTime applet"), 'utilities-teatime');
        Main.messageTray.add(source);
        
        let notification = new MessageTray.Notification(source, subject, text);
        notification.setTransient(true);
        source.notify(notification);
    },
    _initCountdown : function(time) {
        this._startTime     = new Date();
        this._stopTime      = new Date();
        this._cntdownStart  = time;
        this._progress      = 0;
        this._stopTime.setTime(this._startTime.getTime() + time*1000); // in msec 

        this.actor.remove_actor(this._logo);         // show timer instead of default icon
        this.actor.add_actor(this._timer);

        this._showNotification(_("Timer set!"), _("%ss to go").format(time));
        this._idleTimeout = Mainloop.timeout_add_seconds(this._dt, Lang.bind(this, this._doCountdown));
    },
    _getRemainingSec: function() {
        let a = new Date();
        return (this._stopTime.getTime() - a.getTime()) * 1e-3;
    },
    _doCountdown : function() {
        let remainingTime = this._getRemainingSec(); 
        this._progress    = (this._cntdownStart - remainingTime) / this._cntdownStart;

        if (remainingTime <= 0) {
            // count down finished, switch display again
            this.actor.remove_actor(this._timer);
            this.actor.add_actor(this._logo);
            if (this._settings.get_boolean(Utils.TEATIME_FULLSCREEN_NOTIFICATION_KEY)) {
                this.dialog = new TeaTimeFullscreenNotification();
                this.dialog.show();
            } else {
                this._showNotification(_("Your tea is ready!"),
                        _("Drink it, while it is hot!"));
            }

            this._idleTimeout = null;
            return false;
        } else {
            this._timer.queue_repaint();
            return true; // continue timer
        }
    },
    _drawTimer : function() {
        let[width, height] = this._timer.get_surface_size();
        let cr = this._timer.get_context();
        let pi = Math.PI;
        let  r = Math.min(width, height) * 0.5;;

        // TODO: get colors from current theme!
        cr.setSourceRGB(0, 0, 0);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        cr.translate(Math.floor(width / 2), Math.floor(height / 2));
        cr.save();

        cr.setSourceRGB(0.2, 0.2, 0.2);
        cr.moveTo(0, 0);
        cr.arc(0, 0, r, 3 / 2 * pi + 2 * pi * this._progress, 3 / 2 * pi + 2
                * pi);
        cr.fill();

        cr.setSourceRGB(0.8, 0.8, 0.8);
        cr.moveTo(0, 0);
        cr.arc(0, 0, r, 3 / 2 * pi, 3 / 2 * pi + 2 * pi * this._progress);
        cr.fill();
    },
	_showPreferences : function() {
		imports.misc.util.spawn(["gnome-shell-extension-prefs", ExtensionUtils.getCurrentExtension().metadata['uuid']]);
		return 0;
	}
});

function init(metadata) {
    // TODO: at some point, add translations
    let theme = imports.gi.Gtk.IconTheme.get_default();
    theme.append_search_path(metadata.path);
}

let _TeaTime;

function enable() {
    _TeaTime = new TeaTime();
    Main.panel.addToStatusArea('teatime', _TeaTime);
}

function disable() {
    if (_TeaTime._idleTimeout != null) Mainloop.source_remove(_TeaTime._idleTimeout);
    _TeaTime.destroy();
};
